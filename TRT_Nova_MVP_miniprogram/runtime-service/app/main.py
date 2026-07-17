from __future__ import annotations

from fastapi import FastAPI

from .config import load_runtime_config
from .models import (
    CommandDetailQueryRequest,
    CommandDetailResponse,
    CommandListQueryRequest,
    CommandListResponse,
    CommandSendRequest,
    CommandSendResponse,
    IngestResponse,
    LatestDeviceResponse,
    LatestQueryRequest,
    UnifiedDeviceMessage,
)
from .providers import create_command_provider
from .repositories import create_runtime_repository
from .runtime_cache import create_runtime_cache
from .services import RuntimeService

runtime_config = load_runtime_config()

app = FastAPI(
    title="TRT Nova Runtime Service",
    version="0.1.0",
    description="Scaffold for device runtime, latest-state query, and command tracking.",
)

runtime_service = RuntimeService(
    config=runtime_config,
    repository=create_runtime_repository(runtime_config.storage_backend, runtime_config.mysql_dsn),
    runtime_cache=create_runtime_cache(
        runtime_config.runtime_cache_backend,
        redis_url=runtime_config.redis_url,
        key_prefix=runtime_config.redis_key_prefix,
        latest_ttl_sec=runtime_config.redis_device_latest_ttl_sec,
        online_ttl_sec=runtime_config.redis_device_online_ttl_sec,
        command_ttl_sec=runtime_config.redis_command_state_ttl_sec,
        dedup_ttl_sec=runtime_config.redis_message_dedup_ttl_sec,
    ),
    command_provider=create_command_provider(runtime_config.command_provider_backend),
)


@app.get("/health")
def health() -> dict:
    return runtime_service.health()


@app.post("/runtime/ingest/message", response_model=IngestResponse)
def ingest_message(message: UnifiedDeviceMessage) -> IngestResponse:
    return runtime_service.ingest_message(message)


@app.post("/runtime/device/latest", response_model=LatestDeviceResponse)
def query_latest(request: LatestQueryRequest) -> LatestDeviceResponse:
    return runtime_service.query_latest(request.logicalKey)


@app.post("/runtime/device/commands", response_model=CommandListResponse)
def query_commands(request: CommandListQueryRequest) -> CommandListResponse:
    return runtime_service.query_commands(request.logicalKey, request.limit)


@app.post("/runtime/device/command/detail", response_model=CommandDetailResponse)
def query_command_detail(request: CommandDetailQueryRequest) -> CommandDetailResponse:
    return runtime_service.query_command_detail(request.commandId)


@app.post("/runtime/device/command/send", response_model=CommandSendResponse)
def send_command(request: CommandSendRequest) -> CommandSendResponse:
    return runtime_service.send_command(request)
