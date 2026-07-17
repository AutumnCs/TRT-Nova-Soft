from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class RuntimeConfig:
    env: str = "dev"
    host: str = "0.0.0.0"
    port: int = 18080
    storage_backend: str = "memory"
    runtime_cache_backend: str = "noop"
    command_provider_backend: str = "mock"
    device_offline_timeout_ms: int = 10 * 60 * 1000
    mysql_dsn: str = ""
    redis_url: str = ""
    redis_key_prefix: str = "trt:nova"
    redis_device_latest_ttl_sec: int = 3600
    redis_device_online_ttl_sec: int = 1800
    redis_command_state_ttl_sec: int = 3600
    redis_message_dedup_ttl_sec: int = 600
    onenet_api_base: str = ""
    onenet_access_key: str = ""
    onenet_secret_key: str = ""
    emqx_api_base: str = ""
    emqx_api_key: str = ""
    emqx_api_secret: str = ""


def load_runtime_config() -> RuntimeConfig:
    return RuntimeConfig(
        env=os.getenv("RUNTIME_ENV", "dev").strip() or "dev",
        host=os.getenv("RUNTIME_HOST", "0.0.0.0").strip() or "0.0.0.0",
        port=max(1, int(os.getenv("RUNTIME_PORT", "18080") or "18080")),
        storage_backend=os.getenv("STORAGE_BACKEND", "memory").strip() or "memory",
        runtime_cache_backend=os.getenv("RUNTIME_CACHE_BACKEND", "noop").strip() or "noop",
        command_provider_backend=os.getenv("COMMAND_PROVIDER_BACKEND", "mock").strip() or "mock",
        device_offline_timeout_ms=max(
            1000,
            int(os.getenv("DEVICE_OFFLINE_TIMEOUT_MS", str(10 * 60 * 1000)) or str(10 * 60 * 1000)),
        ),
        mysql_dsn=os.getenv("MYSQL_DSN", "").strip(),
        redis_url=os.getenv("REDIS_URL", "").strip(),
        redis_key_prefix=os.getenv("REDIS_KEY_PREFIX", "trt:nova").strip() or "trt:nova",
        redis_device_latest_ttl_sec=max(30, int(os.getenv("REDIS_DEVICE_LATEST_TTL_SEC", "3600") or "3600")),
        redis_device_online_ttl_sec=max(30, int(os.getenv("REDIS_DEVICE_ONLINE_TTL_SEC", "1800") or "1800")),
        redis_command_state_ttl_sec=max(30, int(os.getenv("REDIS_COMMAND_STATE_TTL_SEC", "3600") or "3600")),
        redis_message_dedup_ttl_sec=max(30, int(os.getenv("REDIS_MESSAGE_DEDUP_TTL_SEC", "600") or "600")),
        onenet_api_base=os.getenv("ONENET_API_BASE", "").strip(),
        onenet_access_key=os.getenv("ONENET_ACCESS_KEY", "").strip(),
        onenet_secret_key=os.getenv("ONENET_SECRET_KEY", "").strip(),
        emqx_api_base=os.getenv("EMQX_API_BASE", "").strip(),
        emqx_api_key=os.getenv("EMQX_API_KEY", "").strip(),
        emqx_api_secret=os.getenv("EMQX_API_SECRET", "").strip(),
    )
