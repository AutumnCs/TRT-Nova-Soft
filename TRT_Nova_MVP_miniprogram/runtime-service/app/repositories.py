from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Protocol
from urllib.parse import parse_qs, unquote, urlparse

from .models import RuntimeCommand, UnifiedDeviceMessage


@dataclass
class LatestStateRecord:
    logical_key: str
    provider: str
    product_id: str
    device_name: str
    updated_at: int
    payload: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RuntimeRepositoryState:
    latest_by_logical_key: Dict[str, LatestStateRecord] = field(default_factory=dict)
    commands_by_logical_key: Dict[str, List[RuntimeCommand]] = field(default_factory=dict)
    message_dedup: set[tuple[str, str]] = field(default_factory=set)


class RuntimeRepository(Protocol):
    def health_snapshot(self) -> Dict[str, Any]: ...
    def has_message_dedup(self, message: UnifiedDeviceMessage) -> bool: ...
    def mark_message_dedup(self, message: UnifiedDeviceMessage) -> None: ...
    def save_latest_state(self, message: UnifiedDeviceMessage) -> LatestStateRecord: ...
    def get_latest_state(self, logical_key: str) -> LatestStateRecord | None: ...
    def list_commands(self, logical_key: str, limit: int) -> List[RuntimeCommand]: ...
    def get_command(self, command_id: str) -> RuntimeCommand | None: ...
    def prepend_command(self, command: RuntimeCommand) -> None: ...
    def reconcile_commands(self, message: UnifiedDeviceMessage) -> List[Dict[str, Any]]: ...


class MemoryRuntimeRepository:
    def __init__(self, state: RuntimeRepositoryState | None = None) -> None:
        self.state = state or RuntimeRepositoryState()

    def health_snapshot(self) -> Dict[str, Any]:
        return {
            "storageBackend": "memory",
            "logicalKeyCount": len(self.state.latest_by_logical_key),
            "commandBucketCount": len(self.state.commands_by_logical_key),
            "dedupEntryCount": len(self.state.message_dedup),
            "ts": int(time.time() * 1000),
        }

    def has_message_dedup(self, message: UnifiedDeviceMessage) -> bool:
        return (message.deviceId, message.messageId) in self.state.message_dedup

    def mark_message_dedup(self, message: UnifiedDeviceMessage) -> None:
        self.state.message_dedup.add((message.deviceId, message.messageId))

    def save_latest_state(self, message: UnifiedDeviceMessage) -> LatestStateRecord:
        record = LatestStateRecord(
            logical_key=message.logicalKey,
            provider=message.provider,
            product_id=message.productId,
            device_name=message.deviceName,
            updated_at=message.timestamp,
            payload=message.payload,
        )
        self.state.latest_by_logical_key[message.logicalKey] = record
        return record

    def get_latest_state(self, logical_key: str) -> LatestStateRecord | None:
        return self.state.latest_by_logical_key.get(logical_key)

    def list_commands(self, logical_key: str, limit: int) -> List[RuntimeCommand]:
        return self.state.commands_by_logical_key.get(logical_key, [])[:limit]

    def get_command(self, command_id: str) -> RuntimeCommand | None:
        if not command_id:
          return None
        for commands in self.state.commands_by_logical_key.values():
            for command in commands:
                if command.commandId == command_id:
                    return command
        return None

    def prepend_command(self, command: RuntimeCommand) -> None:
        self.state.commands_by_logical_key.setdefault(command.logicalKey, []).insert(0, command)

    def reconcile_commands(self, message: UnifiedDeviceMessage) -> List[Dict[str, Any]]:
        reconciled_commands: List[Dict[str, Any]] = []
        commands = self.state.commands_by_logical_key.get(message.logicalKey, [])
        payload_params = (message.payload or {}).get("params", {})

        for index, command in enumerate(commands):
            if command.status not in {"pending", "sent", "acked"}:
                continue

            next_status = "acked"
            if payload_params and any(key in payload_params for key in command.sentParams.keys()):
                next_status = "done"

            updated = command.model_copy(
                update={
                    "status": next_status,
                    "ackedAt": message.timestamp if next_status in {"acked", "done"} else command.ackedAt,
                    "doneAt": message.timestamp if next_status == "done" else command.doneAt,
                }
            )
            commands[index] = updated
            reconciled_commands.append({
                "commandId": updated.commandId,
                "toStatus": updated.status,
            })
            break

        return reconciled_commands


def _parse_mysql_dsn(mysql_dsn: str) -> Dict[str, Any]:
    parsed = urlparse(mysql_dsn)
    if parsed.scheme not in {"mysql", "mysql+pymysql"}:
        raise ValueError("MYSQL_DSN must use mysql:// or mysql+pymysql://")

    query = parse_qs(parsed.query or "")
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "database": parsed.path.lstrip("/"),
        "charset": (query.get("charset", ["utf8mb4"])[0] or "utf8mb4"),
        "autocommit": True,
        "cursorclass_name": "DictCursor",
    }


class MySQLRuntimeRepository:
    def __init__(self, mysql_dsn: str) -> None:
        if not mysql_dsn:
            raise ValueError("MYSQL_DSN is required for mysql storage backend")
        self.mysql_dsn = mysql_dsn
        self.connection_kwargs = _parse_mysql_dsn(mysql_dsn)

    def _connect(self):
        try:
            import pymysql
            from pymysql.cursors import DictCursor
        except ImportError as exc:
            raise RuntimeError("pymysql is required for mysql runtime repository") from exc

        kwargs = dict(self.connection_kwargs)
        kwargs["cursorclass"] = DictCursor
        kwargs.pop("cursorclass_name", None)
        return pymysql.connect(**kwargs)

    def health_snapshot(self) -> Dict[str, Any]:
        return {
            "storageBackend": "mysql",
            "dsnConfigured": bool(self.mysql_dsn),
            "host": self.connection_kwargs.get("host", ""),
            "database": self.connection_kwargs.get("database", ""),
            "ts": int(time.time() * 1000),
        }

    def has_message_dedup(self, message: UnifiedDeviceMessage) -> bool:
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT 1
                    FROM device_message_ingest
                    WHERE device_id = %s AND message_id = %s
                    LIMIT 1
                    """,
                    (message.deviceId, message.messageId),
                )
                return cursor.fetchone() is not None

    def mark_message_dedup(self, message: UnifiedDeviceMessage) -> None:
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO device_message_ingest
                      (provider, logical_key, device_id, message_id, message_type, event_type,
                       message_timestamp_ms, payload_json, raw_meta_json)
                    VALUES
                      (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        message.provider,
                        message.logicalKey,
                        message.deviceId,
                        message.messageId,
                        message.messageType or message.type,
                        message.type,
                        message.timestamp,
                        json.dumps(message.payload or {}, ensure_ascii=False),
                        json.dumps(message.sourceMeta.model_dump(), ensure_ascii=False),
                    ),
                )
            conn.commit()

    def save_latest_state(self, message: UnifiedDeviceMessage) -> LatestStateRecord:
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO device_latest
                      (logical_key, product_id, device_name, updated_at_ms, data_id,
                       notify_type, message_type, params_json, push_meta_json)
                    VALUES
                      (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                      product_id = VALUES(product_id),
                      device_name = VALUES(device_name),
                      updated_at_ms = VALUES(updated_at_ms),
                      data_id = VALUES(data_id),
                      notify_type = VALUES(notify_type),
                      message_type = VALUES(message_type),
                      params_json = VALUES(params_json),
                      push_meta_json = VALUES(push_meta_json)
                    """,
                    (
                        message.logicalKey,
                        message.productId,
                        message.deviceName,
                        message.timestamp,
                        message.messageId,
                        message.type,
                        message.messageType,
                        json.dumps((message.payload or {}).get("params", {}), ensure_ascii=False),
                        json.dumps(message.sourceMeta.model_dump(), ensure_ascii=False),
                    ),
                )
            conn.commit()

        return LatestStateRecord(
            logical_key=message.logicalKey,
            provider=message.provider,
            product_id=message.productId,
            device_name=message.deviceName,
            updated_at=message.timestamp,
            payload=message.payload,
        )

    def get_latest_state(self, logical_key: str) -> LatestStateRecord | None:
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT logical_key, product_id, device_name, updated_at_ms, params_json, push_meta_json
                    FROM device_latest
                    WHERE logical_key = %s
                    LIMIT 1
                    """,
                    (logical_key,),
                )
                row = cursor.fetchone()
                if not row:
                    return None

        push_meta = row.get("push_meta_json") or {}
        if isinstance(push_meta, str):
            push_meta = json.loads(push_meta or "{}")
        params_json = row.get("params_json") or {}
        if isinstance(params_json, str):
            params_json = json.loads(params_json or "{}")

        return LatestStateRecord(
            logical_key=row["logical_key"],
            provider=str(push_meta.get("provider", "unknown")),
            product_id=row["product_id"],
            device_name=row["device_name"],
            updated_at=int(row["updated_at_ms"]),
            payload={"params": params_json},
        )

    def list_commands(self, logical_key: str, limit: int) -> List[RuntimeCommand]:
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT command_id, logical_key, product_id, device_name, provider, command_name, status,
                           requested_at_ms, sent_at_ms, acked_at_ms, done_at_ms, failed_at_ms,
                           sent_params_json, latest_snapshot_json, error_message
                    FROM device_commands
                    WHERE logical_key = %s
                    ORDER BY requested_at_ms DESC
                    LIMIT %s
                    """,
                    (logical_key, limit),
                )
                rows = cursor.fetchall() or []

        commands: List[RuntimeCommand] = []
        for row in rows:
            sent_params = row.get("sent_params_json") or {}
            latest_snapshot = row.get("latest_snapshot_json") or {}
            if isinstance(sent_params, str):
                sent_params = json.loads(sent_params or "{}")
            if isinstance(latest_snapshot, str):
                latest_snapshot = json.loads(latest_snapshot or "{}")

            commands.append(
                RuntimeCommand(
                    commandId=row["command_id"],
                    logicalKey=row["logical_key"],
                    productId=row.get("product_id"),
                    deviceName=row.get("device_name"),
                    provider=row.get("provider") or "",
                    commandName=row.get("command_name") or "set_property",
                    status=row.get("status") or "pending",
                    requestedAt=int(row["requested_at_ms"]),
                    sentAt=row.get("sent_at_ms"),
                    ackedAt=row.get("acked_at_ms"),
                    doneAt=row.get("done_at_ms"),
                    failedAt=row.get("failed_at_ms"),
                    sentParams=sent_params,
                    latestSnapshot=latest_snapshot,
                    errorMessage=row.get("error_message") or "",
                )
            )
        return commands

    def get_command(self, command_id: str) -> RuntimeCommand | None:
        if not command_id:
            return None
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT command_id, logical_key, product_id, device_name, provider, command_name, status,
                           requested_at_ms, sent_at_ms, acked_at_ms, done_at_ms, failed_at_ms,
                           sent_params_json, latest_snapshot_json, error_message
                    FROM device_commands
                    WHERE command_id = %s
                    ORDER BY requested_at_ms DESC
                    LIMIT 1
                    """,
                    (command_id,),
                )
                row = cursor.fetchone()
                if not row:
                    return None

        sent_params = row.get("sent_params_json") or {}
        latest_snapshot = row.get("latest_snapshot_json") or {}
        if isinstance(sent_params, str):
            sent_params = json.loads(sent_params or "{}")
        if isinstance(latest_snapshot, str):
            latest_snapshot = json.loads(latest_snapshot or "{}")

        return RuntimeCommand(
            commandId=row["command_id"],
            logicalKey=row["logical_key"],
            productId=row.get("product_id"),
            deviceName=row.get("device_name"),
            provider=row.get("provider") or "",
            commandName=row.get("command_name") or "set_property",
            status=row.get("status") or "pending",
            requestedAt=int(row["requested_at_ms"]),
            sentAt=row.get("sent_at_ms"),
            ackedAt=row.get("acked_at_ms"),
            doneAt=row.get("done_at_ms"),
            failedAt=row.get("failed_at_ms"),
            sentParams=sent_params,
            latestSnapshot=latest_snapshot,
            errorMessage=row.get("error_message") or "",
        )

    def prepend_command(self, command: RuntimeCommand) -> None:
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO device_commands
                      (command_id, logical_key, product_id, device_name, provider, command_name,
                       status, sent_params_json, latest_snapshot_json, error_message,
                       requested_at_ms, sent_at_ms, acked_at_ms, done_at_ms, failed_at_ms)
                    VALUES
                      (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        command.commandId,
                        command.logicalKey,
                        command.productId or "",
                        command.deviceName or "",
                        command.provider,
                        command.commandName,
                        command.status,
                        json.dumps(command.sentParams or {}, ensure_ascii=False),
                        json.dumps(command.latestSnapshot or {}, ensure_ascii=False),
                        command.errorMessage or None,
                        command.requestedAt,
                        command.sentAt,
                        command.ackedAt,
                        command.doneAt,
                        command.failedAt,
                    ),
                )
            conn.commit()

    def reconcile_commands(self, message: UnifiedDeviceMessage) -> List[Dict[str, Any]]:
        commands = self.list_commands(message.logicalKey, 20)
        payload_params = (message.payload or {}).get("params", {})
        reconciled_commands: List[Dict[str, Any]] = []

        for command in commands:
            if command.status not in {"pending", "sent", "acked"}:
                continue

            next_status = "acked"
            if payload_params and any(key in payload_params for key in command.sentParams.keys()):
                next_status = "done"

            with self._connect() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(
                        """
                        UPDATE device_commands
                        SET status = %s,
                            acked_at_ms = CASE WHEN %s IN ('acked', 'done') THEN %s ELSE acked_at_ms END,
                            done_at_ms = CASE WHEN %s = 'done' THEN %s ELSE done_at_ms END
                        WHERE command_id = %s
                        """,
                        (
                            next_status,
                            next_status,
                            message.timestamp,
                            next_status,
                            message.timestamp,
                            command.commandId,
                        ),
                    )
                conn.commit()

            reconciled_commands.append({
                "commandId": command.commandId,
                "toStatus": next_status,
            })
            break

        return reconciled_commands


def create_runtime_repository(storage_backend: str, mysql_dsn: str = "") -> RuntimeRepository:
    normalized = (storage_backend or "memory").strip().lower()
    if normalized == "memory":
        return MemoryRuntimeRepository()
    if normalized == "mysql":
        return MySQLRuntimeRepository(mysql_dsn)
    raise ValueError(f"Unsupported storage backend: {storage_backend}")
