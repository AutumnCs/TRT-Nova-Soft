from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, Dict, List

from .config import RuntimeConfig
from .models import (
    CommandDetailResponse,
    CommandListResponse,
    CommandSendRequest,
    CommandSendResponse,
    IngestResponse,
    LatestDeviceResponse,
    RuntimeCommand,
    UnifiedDeviceMessage,
)
from .providers import CommandProvider
from .repositories import RuntimeRepository
from .runtime_cache import RuntimeCache

logger = logging.getLogger("runtime-service")


def _get_param_node(params: Dict[str, Any], keys: List[str]) -> Any:
    for key in keys:
        node = params.get(key)
        if node is None or node == "":
            continue
        return node
    return None


def _get_param_value(node: Any) -> Any:
    if isinstance(node, dict) and "value" in node:
        return node.get("value")
    return node


def _get_param_time(node: Any) -> int | None:
    if isinstance(node, dict) and node.get("time") is not None:
        try:
            return int(node.get("time"))
        except (TypeError, ValueError):
            return None
    return None


def _normalize_boolean_metric(raw: Any) -> bool | None:
    if raw is True or raw is False:
        return raw
    if raw in (1, "1"):
        return True
    if raw in (0, "0"):
        return False
    if isinstance(raw, str):
        normalized = raw.strip().lower()
        if normalized in {"true", "yes", "dead", "on", "open"}:
            return True
        if normalized in {"false", "no", "alive", "off", "close", "closed"}:
            return False
    return None


class RuntimeService:
    def __init__(
        self,
        *,
        config: RuntimeConfig,
        repository: RuntimeRepository,
        runtime_cache: RuntimeCache,
        command_provider: CommandProvider,
    ) -> None:
        self.config = config
        self.repository = repository
        self.runtime_cache = runtime_cache
        self.command_provider = command_provider

    def _log_event(self, event: str, **fields: Any) -> None:
        payload = {
            "event": event,
            "service": "runtime-service",
            "ts": int(time.time() * 1000),
            **fields,
        }
        logger.info(json.dumps(payload, ensure_ascii=False, sort_keys=True))

    def health(self) -> Dict[str, Any]:
        return {
            "success": True,
            "service": "runtime-service",
            "status": "ok",
            "env": self.config.env,
            "storageBackend": self.config.storage_backend,
            "runtimeCacheBackend": self.config.runtime_cache_backend,
            "commandProviderBackend": self.config.command_provider_backend,
            "details": self.repository.health_snapshot(),
            "cache": self.runtime_cache.health_snapshot(),
            "ts": int(time.time() * 1000),
        }

    def ingest_message(self, message: UnifiedDeviceMessage) -> IngestResponse:
        if self.runtime_cache.has_message_dedup(message.deviceId, message.messageId):
            self._log_event(
                "runtime_ingest",
                logicalKey=message.logicalKey,
                messageId=message.messageId,
                deduplicated=True,
                dedupSource="runtime_cache",
                reconciledCommandCount=0,
            )
            return IngestResponse(
                success=True,
                deduplicated=True,
                logicalKey=message.logicalKey,
                messageId=message.messageId,
                recordCount=0,
                reconciledCommands=[],
            )

        if self.repository.has_message_dedup(message):
            self.runtime_cache.mark_message_dedup(
                message.deviceId,
                message.messageId,
                {
                    "logicalKey": message.logicalKey,
                    "provider": message.provider,
                    "messageId": message.messageId,
                    "updatedAt": message.timestamp,
                },
            )
            self._log_event(
                "runtime_ingest",
                logicalKey=message.logicalKey,
                messageId=message.messageId,
                deduplicated=True,
                dedupSource="repository",
                reconciledCommandCount=0,
            )
            return IngestResponse(
                success=True,
                deduplicated=True,
                logicalKey=message.logicalKey,
                messageId=message.messageId,
                recordCount=0,
                reconciledCommands=[],
            )

        self.repository.mark_message_dedup(message)
        self.repository.save_latest_state(message)
        reconciled_commands = self.repository.reconcile_commands(message)
        self.runtime_cache.mark_message_dedup(
            message.deviceId,
            message.messageId,
            {
                "logicalKey": message.logicalKey,
                "provider": message.provider,
                "messageId": message.messageId,
                "updatedAt": message.timestamp,
            },
        )
        self.runtime_cache.set_latest_state(
            {
                "logicalKey": message.logicalKey,
                "provider": message.provider,
                "productId": message.productId,
                "deviceName": message.deviceName,
                "updatedAt": message.timestamp,
                "payload": message.payload,
            }
        )
        self.runtime_cache.set_online_state(
            {
                "logicalKey": message.logicalKey,
                "provider": message.provider,
                "productId": message.productId,
                "deviceName": message.deviceName,
                "online": True,
                "offline": False,
                "onlineStatus": "online",
                "lastSeenAt": message.timestamp,
                "updatedAt": message.timestamp,
            }
        )
        for reconciled in reconciled_commands:
            self.runtime_cache.set_command_state(
                {
                    "commandId": reconciled["commandId"],
                    "logicalKey": message.logicalKey,
                    "provider": message.provider,
                    "status": reconciled["toStatus"],
                    "updatedAt": message.timestamp,
                }
            )
            if reconciled["toStatus"] in {"acked", "done"}:
                self.runtime_cache.clear_command_processing(reconciled["commandId"])

        self._log_event(
            "runtime_ingest",
            logicalKey=message.logicalKey,
            messageId=message.messageId,
            deduplicated=False,
            dedupSource="none",
            reconciledCommandCount=len(reconciled_commands),
        )

        return IngestResponse(
            success=True,
            deduplicated=False,
            logicalKey=message.logicalKey,
            messageId=message.messageId,
            recordCount=1,
            reconciledCommands=reconciled_commands,
        )

    def _derive_online_state(self, updated_at: int | None, has_latest: bool) -> Dict[str, Any]:
        last_seen_at = int(updated_at or 0)
        if not has_latest or not last_seen_at:
            return {
                "online": False,
                "offline": True,
                "onlineStatus": "never_reported",
                "lastSeenAt": last_seen_at or None,
                "offlineSinceMs": None,
            }

        now_ms = int(time.time() * 1000)
        delta_ms = max(0, now_ms - last_seen_at)
        online = delta_ms <= self.config.device_offline_timeout_ms
        return {
            "online": online,
            "offline": not online,
            "onlineStatus": "online" if online else "offline",
            "lastSeenAt": last_seen_at,
            "offlineSinceMs": None if online else (last_seen_at + self.config.device_offline_timeout_ms),
        }

    def _pick_latest_command(
        self,
        repository_command: RuntimeCommand | None,
        cache_command: Dict[str, Any],
    ) -> Dict[str, Any]:
        repo_requested_at = repository_command.requestedAt if repository_command else 0
        cache_updated_at = int(cache_command.get("updatedAt") or 0) if cache_command else 0

        if cache_updated_at > repo_requested_at:
            return {
                "commandId": cache_command.get("commandId"),
                "status": cache_command.get("status"),
                "provider": cache_command.get("provider"),
                "requestedAt": cache_command.get("requestedAt"),
                "sentAt": cache_command.get("sentAt"),
                "ackedAt": cache_command.get("ackedAt"),
                "doneAt": cache_command.get("doneAt"),
                "failedAt": cache_command.get("failedAt"),
            }

        if repository_command:
            return {
                "commandId": repository_command.commandId,
                "status": repository_command.status,
                "provider": repository_command.provider,
                "requestedAt": repository_command.requestedAt,
                "sentAt": repository_command.sentAt,
                "ackedAt": repository_command.ackedAt,
                "doneAt": repository_command.doneAt,
                "failedAt": repository_command.failedAt,
            }

        return {
            "commandId": cache_command.get("commandId") if cache_command else None,
            "status": cache_command.get("status") if cache_command else None,
            "provider": cache_command.get("provider") if cache_command else None,
            "requestedAt": cache_command.get("requestedAt") if cache_command else None,
            "sentAt": cache_command.get("sentAt") if cache_command else None,
            "ackedAt": cache_command.get("ackedAt") if cache_command else None,
            "doneAt": cache_command.get("doneAt") if cache_command else None,
            "failedAt": cache_command.get("failedAt") if cache_command else None,
        }

    def _merge_latest_state(
        self,
        logical_key: str,
        latest: Any,
        latest_command: RuntimeCommand | None,
        cache_latest: Dict[str, Any],
        cache_online: Dict[str, Any],
        cache_command: Dict[str, Any],
        *,
        cache_latest_is_primary: bool,
    ) -> Dict[str, Any]:
        merged: Dict[str, Any] = {
            "logicalKey": logical_key,
            "provider": latest.provider if latest else "unknown",
            "productId": latest.product_id if latest else "",
            "deviceName": latest.device_name if latest else "",
            "updatedAt": latest.updated_at if latest else None,
            "payload": latest.payload if latest else {},
            "hasLatest": bool(latest),
            "latestSource": self.config.storage_backend if latest else "none",
        }

        current_updated_at = int(merged.get("updatedAt") or 0)
        cache_updated_at = int(cache_latest.get("updatedAt") or 0) if cache_latest else 0
        use_cache_latest = bool(cache_latest) and (
            (not merged["hasLatest"])
            or (cache_latest_is_primary and cache_updated_at >= current_updated_at)
        )
        if use_cache_latest:
            merged["provider"] = cache_latest.get("provider") or merged["provider"]
            merged["productId"] = cache_latest.get("productId") or merged["productId"]
            merged["deviceName"] = cache_latest.get("deviceName") or merged["deviceName"]
            merged["updatedAt"] = cache_updated_at or merged["updatedAt"]
            merged["payload"] = cache_latest.get("payload", {}) or {}
            merged["hasLatest"] = True
            merged["latestSource"] = "cache+db" if latest else self.config.runtime_cache_backend

        derived_online = self._derive_online_state(merged.get("updatedAt"), bool(merged["hasLatest"]))
        if cache_online:
            online_state = {
                "online": cache_online.get("online"),
                "offline": cache_online.get("offline"),
                "onlineStatus": cache_online.get("onlineStatus"),
                "lastSeenAt": cache_online.get("lastSeenAt") or cache_online.get("updatedAt") or merged.get("updatedAt"),
                "offlineSinceMs": cache_online.get("offlineSinceMs"),
            }
            if online_state["online"] is None or online_state["offline"] is None or not online_state["onlineStatus"]:
                derived_from_cache = self._derive_online_state(online_state["lastSeenAt"], bool(merged["hasLatest"]))
                online_state = {
                    **derived_from_cache,
                    **{key: value for key, value in online_state.items() if value is not None and value != ""},
                }
            merged["onlineSource"] = self.config.runtime_cache_backend
        else:
            online_state = derived_online
            merged["onlineSource"] = self.config.storage_backend

        merged.update(online_state)
        if (not merged.get("lastSeenAt") or int(merged.get("lastSeenAt") or 0) < int(merged.get("updatedAt") or 0)) and merged.get("updatedAt"):
            merged["lastSeenAt"] = merged["updatedAt"]

        command_state = self._pick_latest_command(latest_command, cache_command)
        merged["latestCommand"] = command_state
        return merged

    def query_latest(self, logical_key: str) -> LatestDeviceResponse:
        cache_latest = self.runtime_cache.get_latest_state(logical_key) or {}
        cache_online = self.runtime_cache.get_online_state(logical_key) or {}
        cache_command = self.runtime_cache.get_latest_command_state(logical_key) or {}
        cache_latest_is_primary = bool(cache_latest)
        latest = None
        latest_command = None

        if not cache_latest:
            latest = self.repository.get_latest_state(logical_key)
            if latest:
                cache_latest = {
                    "logicalKey": logical_key,
                    "provider": latest.provider,
                    "productId": latest.product_id,
                    "deviceName": latest.device_name,
                    "updatedAt": latest.updated_at,
                    "payload": latest.payload,
                }
                self.runtime_cache.set_latest_state(cache_latest)

        command_status = str(cache_command.get("status") or "") if cache_command else ""
        should_refresh_command_from_repo = (not cache_command) or command_status in {"pending", "sent", "acked"}
        if should_refresh_command_from_repo:
            commands = self.repository.list_commands(logical_key, 1)
            latest_command = commands[0] if commands else None
            if latest_command:
                repo_command_updated_at = (
                    latest_command.doneAt
                    or latest_command.ackedAt
                    or latest_command.sentAt
                    or latest_command.failedAt
                    or latest_command.requestedAt
                )
                cache_command_updated_at = int(cache_command.get("updatedAt") or 0) if cache_command else 0
                if (not cache_command) or repo_command_updated_at >= cache_command_updated_at:
                    cache_command = {
                        "commandId": latest_command.commandId,
                        "logicalKey": latest_command.logicalKey,
                        "productId": latest_command.productId,
                        "deviceName": latest_command.deviceName,
                        "provider": latest_command.provider,
                        "commandName": latest_command.commandName,
                        "status": latest_command.status,
                        "requestedAt": latest_command.requestedAt,
                        "sentAt": latest_command.sentAt,
                        "ackedAt": latest_command.ackedAt,
                        "doneAt": latest_command.doneAt,
                        "failedAt": latest_command.failedAt,
                        "sentParams": latest_command.sentParams,
                        "latestSnapshot": latest_command.latestSnapshot,
                        "errorMessage": latest_command.errorMessage,
                        "updatedAt": repo_command_updated_at,
                    }
                    self.runtime_cache.set_command_state(cache_command)
                else:
                    latest_command = None

        merged = self._merge_latest_state(
            logical_key,
            latest,
            latest_command,
            cache_latest,
            cache_online,
            cache_command,
            cache_latest_is_primary=cache_latest_is_primary,
        )
        if not cache_online and merged.get("hasLatest"):
            self.runtime_cache.set_online_state(
                {
                    "logicalKey": logical_key,
                    "provider": merged.get("provider"),
                    "productId": merged.get("productId"),
                    "deviceName": merged.get("deviceName"),
                    "online": merged.get("online"),
                    "offline": merged.get("offline"),
                    "onlineStatus": merged.get("onlineStatus"),
                    "lastSeenAt": merged.get("lastSeenAt"),
                    "offlineSinceMs": merged.get("offlineSinceMs"),
                    "updatedAt": merged.get("updatedAt"),
                }
            )
        payload = merged.get("payload", {}) if isinstance(merged.get("payload"), dict) else {}
        params = payload.get("params", {}) if isinstance(payload.get("params"), dict) else {}
        temp_node = _get_param_node(params, ["dht_temp", "temp", "temperature", "air_temp"])
        humidity_node = _get_param_node(params, ["dht_humi", "humidity", "air_humidity"])
        soil_node = _get_param_node(params, ["soil_percent", "soil", "soil_moisture"])
        fan_node = _get_param_node(params, ["fan_switch", "test"])
        latest_command = merged.get("latestCommand") or {}
        latest_command_status = latest_command.get("status")
        is_pending = bool(latest_command_status and latest_command_status in {"pending", "sent", "acked"})

        response = LatestDeviceResponse(
            logicalKey=logical_key,
            provider=str(merged.get("provider") or "unknown"),
            productId=merged.get("productId") or None,
            deviceName=merged.get("deviceName") or None,
            online=bool(merged.get("online")),
            offline=bool(merged.get("offline")),
            onlineStatus=str(merged.get("onlineStatus") or "never_reported"),
            lastSeenAt=merged.get("lastSeenAt"),
            offlineSinceMs=merged.get("offlineSinceMs"),
            updatedAt=merged.get("updatedAt"),
            params=params,
            latestCommand=latest_command,
            sensorSnapshot={
                "temp": {
                    "value": _get_param_value(temp_node),
                    "time": _get_param_time(temp_node),
                    "unit": "C",
                },
                "humidity": {
                    "value": _get_param_value(humidity_node),
                    "time": _get_param_time(humidity_node),
                    "unit": "%",
                },
                "soil": {
                    "value": _get_param_value(soil_node),
                    "time": _get_param_time(soil_node),
                    "unit": "%",
                },
            },
            controlSnapshot={
                "fan": {
                    "reportedState": _normalize_boolean_metric(_get_param_value(fan_node)),
                    "pending": is_pending,
                    "latestCommandId": latest_command.get("commandId"),
                    "latestCommandStatus": latest_command_status,
                }
            },
            plantSnapshot={},
            displaySnapshot={
                "onlineStatusText": str(merged.get("onlineStatus") or "never_reported"),
            },
            cacheMeta={
                "latestSource": merged.get("latestSource"),
                "onlineSource": merged.get("onlineSource"),
            },
        )
        self._log_event(
            "runtime_query_latest",
            logicalKey=logical_key,
            onlineStatus=response.onlineStatus,
            latestCommandStatus=response.latestCommand.get("status") if response.latestCommand else None,
            **response.cacheMeta,
        )
        return response

    def query_commands(self, logical_key: str, limit: int) -> CommandListResponse:
        repository_commands = self.repository.list_commands(logical_key, limit)
        cache_command = self.runtime_cache.get_latest_command_state(logical_key) or {}
        if not cache_command:
            response = CommandListResponse(
                logicalKey=logical_key,
                commands=repository_commands,
                cacheMeta={
                    "source": self.config.storage_backend,
                    "mode": "repo_only",
                    "hits": 0,
                    "misses": 1,
                },
            )
            self._log_event(
                "runtime_query_commands",
                logicalKey=logical_key,
                limit=limit,
                commandCount=len(response.commands),
                **response.cacheMeta,
            )
            return response

        cache_command_id = cache_command.get("commandId")
        if not cache_command_id:
            response = CommandListResponse(
                logicalKey=logical_key,
                commands=repository_commands,
                cacheMeta={
                    "source": self.config.storage_backend,
                    "mode": "repo_only",
                    "hits": 0,
                    "misses": 1,
                },
            )
            self._log_event(
                "runtime_query_commands",
                logicalKey=logical_key,
                limit=limit,
                commandCount=len(response.commands),
                **response.cacheMeta,
            )
            return response

        merged_commands: List[RuntimeCommand] = []
        matched = False
        for command in repository_commands:
            if command.commandId == cache_command_id:
                matched = True
                merged_commands.append(
                    command.model_copy(
                        update={
                            "logicalKey": cache_command.get("logicalKey") or command.logicalKey,
                            "productId": cache_command.get("productId") or command.productId,
                            "deviceName": cache_command.get("deviceName") or command.deviceName,
                            "provider": cache_command.get("provider") or command.provider,
                            "commandName": cache_command.get("commandName") or command.commandName,
                            "status": cache_command.get("status") or command.status,
                            "requestedAt": cache_command.get("requestedAt") or command.requestedAt,
                            "sentAt": cache_command.get("sentAt") or command.sentAt,
                            "ackedAt": cache_command.get("ackedAt") or command.ackedAt,
                            "doneAt": cache_command.get("doneAt") or command.doneAt,
                            "failedAt": cache_command.get("failedAt") or command.failedAt,
                            "sentParams": cache_command.get("sentParams") or command.sentParams,
                            "latestSnapshot": cache_command.get("latestSnapshot") or command.latestSnapshot,
                            "errorMessage": cache_command.get("errorMessage")
                            if cache_command.get("errorMessage") is not None
                            else command.errorMessage,
                        }
                    )
                )
            else:
                merged_commands.append(command)

        if not matched:
            cache_only_command = RuntimeCommand(
                commandId=cache_command.get("commandId"),
                logicalKey=cache_command.get("logicalKey") or logical_key,
                productId=cache_command.get("productId"),
                deviceName=cache_command.get("deviceName"),
                provider=cache_command.get("provider") or "",
                commandName=cache_command.get("commandName") or "set_property",
                status=cache_command.get("status") or "pending",
                requestedAt=int(cache_command.get("requestedAt") or cache_command.get("updatedAt") or int(time.time() * 1000)),
                sentAt=cache_command.get("sentAt"),
                ackedAt=cache_command.get("ackedAt"),
                doneAt=cache_command.get("doneAt"),
                failedAt=cache_command.get("failedAt"),
                sentParams=cache_command.get("sentParams") or {},
                latestSnapshot=cache_command.get("latestSnapshot") or {},
                errorMessage=cache_command.get("errorMessage") or "",
            )
            merged_commands = [cache_only_command, *merged_commands]

        response = CommandListResponse(
            logicalKey=logical_key,
            commands=merged_commands[:limit],
            cacheMeta={
                "source": self.config.runtime_cache_backend,
                "mode": "cache_merged" if matched else "cache_only_injected",
                "hits": 1,
                "misses": 0,
            },
        )
        self._log_event(
            "runtime_query_commands",
            logicalKey=logical_key,
            limit=limit,
            commandCount=len(response.commands),
            **response.cacheMeta,
        )
        return response

    def query_command_detail(self, command_id: str) -> CommandDetailResponse:
        repository_command = self.repository.get_command(command_id)
        cache_state = self.runtime_cache.get_command_state(command_id) or {}

        if not repository_command and not cache_state:
            response = CommandDetailResponse(
                success=False,
                command=None,
                cacheMeta={
                    "requested": 1,
                    "hits": 0,
                    "misses": 1,
                },
            )
            self._log_event(
                "runtime_query_command_detail",
                commandId=command_id,
                success=response.success,
                **response.cacheMeta,
            )
            return response

        if repository_command:
            command = repository_command.model_copy(
                update={
                    "logicalKey": cache_state.get("logicalKey") or repository_command.logicalKey,
                    "productId": cache_state.get("productId") or repository_command.productId,
                    "deviceName": cache_state.get("deviceName") or repository_command.deviceName,
                    "provider": cache_state.get("provider") or repository_command.provider,
                    "commandName": cache_state.get("commandName") or repository_command.commandName,
                    "status": cache_state.get("status") or repository_command.status,
                    "requestedAt": cache_state.get("requestedAt") or repository_command.requestedAt,
                    "sentAt": cache_state.get("sentAt") or repository_command.sentAt,
                    "ackedAt": cache_state.get("ackedAt") or repository_command.ackedAt,
                    "doneAt": cache_state.get("doneAt") or repository_command.doneAt,
                    "failedAt": cache_state.get("failedAt") or repository_command.failedAt,
                    "sentParams": cache_state.get("sentParams") or repository_command.sentParams,
                    "latestSnapshot": cache_state.get("latestSnapshot") or repository_command.latestSnapshot,
                    "errorMessage": cache_state.get("errorMessage")
                    if cache_state.get("errorMessage") is not None
                    else repository_command.errorMessage,
                }
            )
        else:
            command = RuntimeCommand(
                commandId=cache_state.get("commandId") or command_id,
                logicalKey=cache_state.get("logicalKey") or "",
                productId=cache_state.get("productId"),
                deviceName=cache_state.get("deviceName"),
                provider=cache_state.get("provider") or "",
                commandName=cache_state.get("commandName") or "set_property",
                status=cache_state.get("status") or "pending",
                requestedAt=int(cache_state.get("requestedAt") or cache_state.get("updatedAt") or int(time.time() * 1000)),
                sentAt=cache_state.get("sentAt"),
                ackedAt=cache_state.get("ackedAt"),
                doneAt=cache_state.get("doneAt"),
                failedAt=cache_state.get("failedAt"),
                sentParams=cache_state.get("sentParams") or {},
                latestSnapshot=cache_state.get("latestSnapshot") or {},
                errorMessage=cache_state.get("errorMessage") or "",
            )

        response = CommandDetailResponse(
            success=True,
            command=command,
            cacheMeta={
                "source": self.config.runtime_cache_backend if cache_state else self.config.storage_backend,
                "mode": "cache_merged" if (repository_command and cache_state) else ("cache_only" if cache_state else "repo_only"),
                "requested": 1,
                "hits": 1 if cache_state else 0,
                "misses": 0 if cache_state else 1,
            },
        )
        self._log_event(
            "runtime_query_command_detail",
            commandId=command_id,
            logicalKey=command.logicalKey if command else None,
            success=response.success,
            commandStatus=command.status if command else None,
            **response.cacheMeta,
        )
        return response

    def send_command(self, request: CommandSendRequest) -> CommandSendResponse:
        command_id = f"cmd_{uuid.uuid4().hex[:12]}"
        now_ms = int(time.time() * 1000)
        latest = self.repository.get_latest_state(request.logicalKey)
        provider = (request.provider or (latest.provider if latest else "") or "onenet").lower()
        product_id = (latest.product_id if latest else "") or (request.productId or "")
        device_name = (latest.device_name if latest else "") or (request.deviceName or "")

        dispatch_result = self.command_provider.send_command(
            provider=provider,
            logical_key=request.logicalKey,
            product_id=product_id,
            device_name=device_name,
            params=request.params,
        )

        status = "sent" if dispatch_result.success else "failed"

        command = RuntimeCommand(
            commandId=command_id,
            logicalKey=request.logicalKey,
            productId=product_id or None,
            deviceName=device_name or None,
            provider=provider,
            status=status,
            requestedAt=now_ms,
            sentAt=dispatch_result.sent_at_ms if dispatch_result.success else None,
            failedAt=dispatch_result.sent_at_ms if not dispatch_result.success else None,
            sentParams=request.params,
            latestSnapshot=latest.payload if latest else {},
            errorMessage="" if dispatch_result.success else (dispatch_result.message or "provider dispatch failed"),
        )

        self.repository.prepend_command(command)
        self.runtime_cache.set_command_processing(
            {
                "commandId": command.commandId,
                "logicalKey": command.logicalKey,
                "provider": command.provider,
                "status": command.status,
                "productId": command.productId,
                "deviceName": command.deviceName,
                "updatedAt": now_ms,
            }
        )
        self.runtime_cache.set_command_state(
            {
                "commandId": command.commandId,
                "logicalKey": command.logicalKey,
                "provider": command.provider,
                "status": command.status,
                "productId": command.productId,
                "deviceName": command.deviceName,
                "sentParams": command.sentParams,
                "updatedAt": now_ms,
            }
        )
        if status == "failed":
            self.runtime_cache.clear_command_processing(command.commandId)

        response = CommandSendResponse(
            success=dispatch_result.success,
            commandId=command.commandId,
            commandStatus=command.status,
            provider=command.provider,
            logicalKey=request.logicalKey,
            productId=product_id or None,
            deviceName=device_name or None,
            sentParams=request.params,
            msg=None if dispatch_result.success else dispatch_result.message,
        )
        self._log_event(
            "runtime_send_command",
            logicalKey=request.logicalKey,
            commandId=response.commandId,
            provider=response.provider,
            commandStatus=response.commandStatus,
            success=response.success,
        )
        return response
