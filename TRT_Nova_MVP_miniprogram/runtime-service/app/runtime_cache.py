from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Protocol
from urllib.parse import urlparse


@dataclass
class RuntimeCacheState:
    latest_by_logical_key: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    online_by_logical_key: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    command_state_by_id: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    latest_command_by_logical_key: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    processing_by_command_id: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    dedup_by_key: set[str] = field(default_factory=set)


class RuntimeCache(Protocol):
    def health_snapshot(self) -> Dict[str, Any]: ...
    def has_message_dedup(self, device_id: str, message_id: str) -> bool: ...
    def set_latest_state(self, payload: Dict[str, Any]) -> bool: ...
    def get_latest_state(self, logical_key: str) -> Dict[str, Any] | None: ...
    def set_online_state(self, payload: Dict[str, Any]) -> bool: ...
    def get_online_state(self, logical_key: str) -> Dict[str, Any] | None: ...
    def set_command_state(self, payload: Dict[str, Any]) -> bool: ...
    def get_command_state(self, command_id: str) -> Dict[str, Any] | None: ...
    def get_latest_command_state(self, logical_key: str) -> Dict[str, Any] | None: ...
    def set_command_processing(self, payload: Dict[str, Any]) -> bool: ...
    def clear_command_processing(self, command_id: str) -> bool: ...
    def mark_message_dedup(self, device_id: str, message_id: str, payload: Dict[str, Any]) -> bool: ...


class NoopRuntimeCache:
    def health_snapshot(self) -> Dict[str, Any]:
        return {
            "cacheBackend": "noop",
            "enabled": False,
            "ts": int(time.time() * 1000),
        }

    def set_latest_state(self, payload: Dict[str, Any]) -> bool:
        return False

    def has_message_dedup(self, device_id: str, message_id: str) -> bool:
        return False

    def get_latest_state(self, logical_key: str) -> Dict[str, Any] | None:
        return None

    def set_online_state(self, payload: Dict[str, Any]) -> bool:
        return False

    def get_online_state(self, logical_key: str) -> Dict[str, Any] | None:
        return None

    def set_command_state(self, payload: Dict[str, Any]) -> bool:
        return False

    def get_command_state(self, command_id: str) -> Dict[str, Any] | None:
        return None

    def get_latest_command_state(self, logical_key: str) -> Dict[str, Any] | None:
        return None

    def set_command_processing(self, payload: Dict[str, Any]) -> bool:
        return False

    def clear_command_processing(self, command_id: str) -> bool:
        return False

    def mark_message_dedup(self, device_id: str, message_id: str, payload: Dict[str, Any]) -> bool:
        return False


class MemoryRuntimeCache:
    def __init__(self, state: RuntimeCacheState | None = None, key_prefix: str = "trt:nova") -> None:
        self.state = state or RuntimeCacheState()
        self.key_prefix = key_prefix

    def health_snapshot(self) -> Dict[str, Any]:
        return {
            "cacheBackend": "memory",
            "enabled": True,
            "latestCount": len(self.state.latest_by_logical_key),
            "onlineCount": len(self.state.online_by_logical_key),
            "commandStateCount": len(self.state.command_state_by_id),
            "processingCount": len(self.state.processing_by_command_id),
            "dedupCount": len(self.state.dedup_by_key),
            "ts": int(time.time() * 1000),
        }

    def has_message_dedup(self, device_id: str, message_id: str) -> bool:
        if not device_id or not message_id:
            return False
        return f"{device_id}:{message_id}" in self.state.dedup_by_key

    def set_latest_state(self, payload: Dict[str, Any]) -> bool:
        logical_key = payload.get("logicalKey")
        if not logical_key:
            return False
        self.state.latest_by_logical_key[logical_key] = dict(payload)
        return True

    def get_latest_state(self, logical_key: str) -> Dict[str, Any] | None:
        return self.state.latest_by_logical_key.get(logical_key)

    def set_online_state(self, payload: Dict[str, Any]) -> bool:
        logical_key = payload.get("logicalKey")
        if not logical_key:
            return False
        self.state.online_by_logical_key[logical_key] = dict(payload)
        return True

    def get_online_state(self, logical_key: str) -> Dict[str, Any] | None:
        return self.state.online_by_logical_key.get(logical_key)

    def set_command_state(self, payload: Dict[str, Any]) -> bool:
        command_id = payload.get("commandId")
        if not command_id:
            return False
        self.state.command_state_by_id[command_id] = dict(payload)
        logical_key = payload.get("logicalKey")
        if logical_key:
            self.state.latest_command_by_logical_key[logical_key] = dict(payload)
        return True

    def get_command_state(self, command_id: str) -> Dict[str, Any] | None:
        return self.state.command_state_by_id.get(command_id)

    def get_latest_command_state(self, logical_key: str) -> Dict[str, Any] | None:
        return self.state.latest_command_by_logical_key.get(logical_key)

    def set_command_processing(self, payload: Dict[str, Any]) -> bool:
        command_id = payload.get("commandId")
        if not command_id:
            return False
        self.state.processing_by_command_id[command_id] = dict(payload)
        return True

    def clear_command_processing(self, command_id: str) -> bool:
        self.state.processing_by_command_id.pop(command_id, None)
        return True

    def mark_message_dedup(self, device_id: str, message_id: str, payload: Dict[str, Any]) -> bool:
        if not device_id or not message_id:
            return False
        self.state.dedup_by_key.add(f"{device_id}:{message_id}")
        return True


def _parse_redis_url(redis_url: str) -> Dict[str, Any]:
    parsed = urlparse(redis_url)
    if parsed.scheme not in {"redis", "rediss"}:
        raise ValueError("REDIS_URL must use redis:// or rediss://")
    return {
        "scheme": parsed.scheme,
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 6379,
        "password": parsed.password or "",
        "db": int((parsed.path or "/0").lstrip("/") or "0"),
    }


class RedisRuntimeCache:
    def __init__(
        self,
        *,
        redis_url: str,
        key_prefix: str = "trt:nova",
        latest_ttl_sec: int = 3600,
        online_ttl_sec: int = 1800,
        command_ttl_sec: int = 3600,
        dedup_ttl_sec: int = 600,
    ) -> None:
        if not redis_url:
            raise ValueError("REDIS_URL is required for redis runtime cache")
        self.redis_url = redis_url
        self.key_prefix = key_prefix
        self.latest_ttl_sec = latest_ttl_sec
        self.online_ttl_sec = online_ttl_sec
        self.command_ttl_sec = command_ttl_sec
        self.dedup_ttl_sec = dedup_ttl_sec
        self.redis_config = _parse_redis_url(redis_url)

    def _connect(self):
        try:
            import redis
        except ImportError as exc:
            raise RuntimeError("redis package is required for redis runtime cache") from exc
        return redis.Redis.from_url(self.redis_url, decode_responses=True)

    def _key(self, *parts: str) -> str:
        return ":".join([self.key_prefix, *parts])

    def _set_json(self, key: str, payload: Dict[str, Any], ttl_sec: int) -> bool:
        client = self._connect()
        client.set(key, json.dumps(payload, ensure_ascii=False), ex=ttl_sec)
        return True

    def _get_json(self, key: str) -> Dict[str, Any] | None:
        client = self._connect()
        raw = client.get(key)
        return json.loads(raw) if raw else None

    def health_snapshot(self) -> Dict[str, Any]:
        return {
            "cacheBackend": "redis",
            "enabled": True,
            "host": self.redis_config["host"],
            "port": self.redis_config["port"],
            "db": self.redis_config["db"],
            "keyPrefix": self.key_prefix,
            "ts": int(time.time() * 1000),
        }

    def has_message_dedup(self, device_id: str, message_id: str) -> bool:
        if not device_id or not message_id:
            return False
        client = self._connect()
        return bool(client.exists(self._key("message", "dedup", device_id, message_id)))

    def set_latest_state(self, payload: Dict[str, Any]) -> bool:
        logical_key = payload.get("logicalKey")
        if not logical_key:
            return False
        return self._set_json(self._key("device", "latest", logical_key), payload, self.latest_ttl_sec)

    def get_latest_state(self, logical_key: str) -> Dict[str, Any] | None:
        return self._get_json(self._key("device", "latest", logical_key))

    def set_online_state(self, payload: Dict[str, Any]) -> bool:
        logical_key = payload.get("logicalKey")
        if not logical_key:
            return False
        return self._set_json(self._key("device", "online", logical_key), payload, self.online_ttl_sec)

    def get_online_state(self, logical_key: str) -> Dict[str, Any] | None:
        return self._get_json(self._key("device", "online", logical_key))

    def set_command_state(self, payload: Dict[str, Any]) -> bool:
        command_id = payload.get("commandId")
        if not command_id:
            return False
        self._set_json(self._key("command", "state", command_id), payload, self.command_ttl_sec)
        logical_key = payload.get("logicalKey")
        if logical_key:
            self._set_json(self._key("device", "command", "latest", logical_key), payload, self.command_ttl_sec)
        return True

    def get_command_state(self, command_id: str) -> Dict[str, Any] | None:
        return self._get_json(self._key("command", "state", command_id))

    def get_latest_command_state(self, logical_key: str) -> Dict[str, Any] | None:
        return self._get_json(self._key("device", "command", "latest", logical_key))

    def set_command_processing(self, payload: Dict[str, Any]) -> bool:
        command_id = payload.get("commandId")
        if not command_id:
            return False
        return self._set_json(self._key("command", "processing", command_id), payload, self.command_ttl_sec)

    def clear_command_processing(self, command_id: str) -> bool:
        client = self._connect()
        client.delete(self._key("command", "processing", command_id))
        return True

    def mark_message_dedup(self, device_id: str, message_id: str, payload: Dict[str, Any]) -> bool:
        if not device_id or not message_id:
            return False
        return self._set_json(
            self._key("message", "dedup", device_id, message_id),
            payload,
            self.dedup_ttl_sec,
        )


def create_runtime_cache(
    backend: str,
    *,
    redis_url: str = "",
    key_prefix: str = "trt:nova",
    latest_ttl_sec: int = 3600,
    online_ttl_sec: int = 1800,
    command_ttl_sec: int = 3600,
    dedup_ttl_sec: int = 600,
) -> RuntimeCache:
    normalized = (backend or "noop").strip().lower()
    if normalized == "noop":
        return NoopRuntimeCache()
    if normalized == "memory":
        return MemoryRuntimeCache(key_prefix=key_prefix)
    if normalized == "redis":
        return RedisRuntimeCache(
            redis_url=redis_url,
            key_prefix=key_prefix,
            latest_ttl_sec=latest_ttl_sec,
            online_ttl_sec=online_ttl_sec,
            command_ttl_sec=command_ttl_sec,
            dedup_ttl_sec=dedup_ttl_sec,
        )
    raise ValueError(f"Unsupported runtime cache backend: {backend}")
