from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Dict, Protocol


@dataclass(frozen=True)
class CommandDispatchResult:
    success: bool
    provider: str
    status: str
    sent_at_ms: int
    message: str = ""
    provider_response: Dict[str, Any] | None = None


class CommandProvider(Protocol):
    def send_command(
        self,
        *,
        provider: str,
        logical_key: str,
        product_id: str,
        device_name: str,
        params: Dict[str, Any],
    ) -> CommandDispatchResult: ...


class MockCommandProvider:
    def send_command(
        self,
        *,
        provider: str,
        logical_key: str,
        product_id: str,
        device_name: str,
        params: Dict[str, Any],
    ) -> CommandDispatchResult:
        now_ms = int(time.time() * 1000)
        return CommandDispatchResult(
            success=True,
            provider=provider or "onenet",
            status="sent",
            sent_at_ms=now_ms,
            message="mock dispatch accepted",
            provider_response={
                "logicalKey": logical_key,
                "productId": product_id,
                "deviceName": device_name,
                "sentParams": params,
                "mock": True,
            },
        )


def create_command_provider(backend: str) -> CommandProvider:
    normalized = (backend or "mock").strip().lower()
    if normalized == "mock":
        return MockCommandProvider()
    raise ValueError(f"Unsupported command provider backend: {backend}")
