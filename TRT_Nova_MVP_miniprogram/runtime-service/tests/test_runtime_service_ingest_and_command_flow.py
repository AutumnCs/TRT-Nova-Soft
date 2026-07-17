import time
import unittest

from app.config import RuntimeConfig
from app.models import CommandSendRequest, UnifiedDeviceMessage
from app.providers import CommandDispatchResult
from app.repositories import MemoryRuntimeRepository
from app.runtime_cache import MemoryRuntimeCache
from app.services import RuntimeService


class AlwaysSuccessProvider:
    def send_command(self, *, provider, logical_key, product_id, device_name, params):
        now_ms = int(time.time() * 1000)
        return CommandDispatchResult(
            success=True,
            provider=provider or "onenet",
            status="sent",
            sent_at_ms=now_ms,
            message="accepted",
            provider_response={"mock": True, "params": params},
        )


class AlwaysFailedProvider:
    def send_command(self, *, provider, logical_key, product_id, device_name, params):
        now_ms = int(time.time() * 1000)
        return CommandDispatchResult(
            success=False,
            provider=provider or "onenet",
            status="failed",
            sent_at_ms=now_ms,
            message="provider rejected",
            provider_response={"mock": True, "params": params},
        )


class RecordingMemoryRepository(MemoryRuntimeRepository):
    def __init__(self) -> None:
        super().__init__()
        self.has_message_dedup_calls = 0

    def has_message_dedup(self, message: UnifiedDeviceMessage) -> bool:
        self.has_message_dedup_calls += 1
        return super().has_message_dedup(message)


class RuntimeServiceIngestAndCommandFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = MemoryRuntimeRepository()
        self.runtime_cache = MemoryRuntimeCache()
        self.service = RuntimeService(
            config=RuntimeConfig(
                storage_backend="memory",
                runtime_cache_backend="memory",
                command_provider_backend="mock",
                device_offline_timeout_ms=10 * 60 * 1000,
            ),
            repository=self.repository,
            runtime_cache=self.runtime_cache,
            command_provider=AlwaysSuccessProvider(),
        )

    def _message(self, *, message_id: str, timestamp: int, params: dict | None = None) -> UnifiedDeviceMessage:
        return UnifiedDeviceMessage(
            provider="onenet",
            deviceId="nova_1",
            logicalKey="nova_1",
            productId="prod_1",
            deviceName="Nova_01",
            messageId=message_id,
            timestamp=timestamp,
            type="property",
            payload={"params": params or {"soil_percent": {"value": 48, "time": timestamp}}},
        )

    def test_ingest_message_deduplicates_repeated_message(self) -> None:
        now_ms = int(time.time() * 1000)
        message = self._message(message_id="msg_dup", timestamp=now_ms)

        first = self.service.ingest_message(message)
        second = self.service.ingest_message(message)

        self.assertFalse(first.deduplicated)
        self.assertEqual(first.recordCount, 1)
        self.assertTrue(second.deduplicated)
        self.assertEqual(second.recordCount, 0)
        self.assertEqual(len(self.repository.state.message_dedup), 1)
        self.assertEqual(self.repository.get_latest_state("nova_1").updated_at, now_ms)

    def test_ingest_message_uses_runtime_cache_to_short_circuit_repeated_dedup_check(self) -> None:
        repository = RecordingMemoryRepository()
        service = RuntimeService(
            config=RuntimeConfig(
                storage_backend="memory",
                runtime_cache_backend="memory",
                command_provider_backend="mock",
                device_offline_timeout_ms=10 * 60 * 1000,
            ),
            repository=repository,
            runtime_cache=MemoryRuntimeCache(),
            command_provider=AlwaysSuccessProvider(),
        )
        now_ms = int(time.time() * 1000)
        message = self._message(message_id="msg_cache_dup", timestamp=now_ms)

        first = service.ingest_message(message)
        second = service.ingest_message(message)

        self.assertFalse(first.deduplicated)
        self.assertTrue(second.deduplicated)
        self.assertEqual(repository.has_message_dedup_calls, 1)

    def test_ingest_message_advances_sent_command_to_acked_without_matching_params(self) -> None:
        now_ms = int(time.time() * 1000)
        send_response = self.service.send_command(
            CommandSendRequest(
                logicalKey="nova_1",
                params={"fan_switch": True},
            )
        )

        ingest_response = self.service.ingest_message(
            self._message(
                message_id="msg_ack",
                timestamp=now_ms + 1_000,
                params={"soil_percent": {"value": 50, "time": now_ms + 1_000}},
            )
        )

        command = self.repository.get_command(send_response.commandId)
        cache_command = self.runtime_cache.get_command_state(send_response.commandId)

        self.assertTrue(send_response.success)
        self.assertEqual(command.status, "acked")
        self.assertIsNotNone(command.ackedAt)
        self.assertIsNone(command.doneAt)
        self.assertEqual(ingest_response.reconciledCommands[0]["toStatus"], "acked")
        self.assertEqual(cache_command["status"], "acked")
        self.assertNotIn(send_response.commandId, self.runtime_cache.state.processing_by_command_id)

    def test_ingest_message_advances_sent_command_to_done_when_matching_param_returns(self) -> None:
        now_ms = int(time.time() * 1000)
        send_response = self.service.send_command(
            CommandSendRequest(
                logicalKey="nova_1",
                params={"fan_switch": True},
            )
        )

        ingest_response = self.service.ingest_message(
            self._message(
                message_id="msg_done",
                timestamp=now_ms + 2_000,
                params={
                    "fan_switch": {"value": True, "time": now_ms + 2_000},
                    "soil_percent": {"value": 52, "time": now_ms + 2_000},
                },
            )
        )

        command = self.repository.get_command(send_response.commandId)
        latest = self.service.query_latest("nova_1")

        self.assertEqual(command.status, "done")
        self.assertIsNotNone(command.ackedAt)
        self.assertIsNotNone(command.doneAt)
        self.assertEqual(ingest_response.reconciledCommands[0]["toStatus"], "done")
        self.assertEqual(latest.latestCommand["commandId"], send_response.commandId)
        self.assertEqual(latest.latestCommand["status"], "done")
        self.assertFalse(latest.controlSnapshot["fan"]["pending"])

    def test_send_command_failure_clears_processing_state(self) -> None:
        failed_service = RuntimeService(
            config=RuntimeConfig(
                storage_backend="memory",
                runtime_cache_backend="memory",
                command_provider_backend="mock",
            ),
            repository=MemoryRuntimeRepository(),
            runtime_cache=MemoryRuntimeCache(),
            command_provider=AlwaysFailedProvider(),
        )

        response = failed_service.send_command(
            CommandSendRequest(
                logicalKey="nova_fail",
                params={"fan_switch": False},
            )
        )

        command = failed_service.repository.get_command(response.commandId)
        cache_command = failed_service.runtime_cache.get_command_state(response.commandId)

        self.assertFalse(response.success)
        self.assertEqual(response.commandStatus, "failed")
        self.assertEqual(command.status, "failed")
        self.assertEqual(cache_command["status"], "failed")
        self.assertNotIn(response.commandId, failed_service.runtime_cache.state.processing_by_command_id)


if __name__ == "__main__":
    unittest.main()
