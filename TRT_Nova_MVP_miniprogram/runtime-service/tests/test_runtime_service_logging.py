import json
import time
import unittest

from app.config import RuntimeConfig
from app.models import RuntimeCommand, UnifiedDeviceMessage
from app.providers import MockCommandProvider
from app.repositories import MemoryRuntimeRepository
from app.runtime_cache import MemoryRuntimeCache
from app.services import RuntimeService


class RuntimeServiceLoggingTests(unittest.TestCase):
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
            command_provider=MockCommandProvider(),
        )

    def _message(self, *, message_id: str, timestamp: int) -> UnifiedDeviceMessage:
        return UnifiedDeviceMessage(
            provider="onenet",
            deviceId="nova_1",
            logicalKey="nova_1",
            productId="prod_1",
            deviceName="Nova_01",
            messageId=message_id,
            timestamp=timestamp,
            type="property",
            payload={"params": {"soil_percent": {"value": 48, "time": timestamp}}},
        )

    def test_ingest_logs_runtime_cache_dedup_hit(self) -> None:
        now_ms = int(time.time() * 1000)
        message = self._message(message_id="msg-log-dedup", timestamp=now_ms)
        self.service.ingest_message(message)

        with self.assertLogs("runtime-service", level="INFO") as logs:
            self.service.ingest_message(message)

        event = json.loads(logs.records[-1].getMessage())
        self.assertEqual(event["event"], "runtime_ingest")
        self.assertTrue(event["deduplicated"])
        self.assertEqual(event["dedupSource"], "runtime_cache")
        self.assertEqual(event["logicalKey"], "nova_1")

    def test_query_commands_logs_cache_mode(self) -> None:
        now_ms = int(time.time() * 1000)
        self.runtime_cache.set_command_state(
            {
                "commandId": "cmd_cache_only",
                "logicalKey": "nova_1",
                "provider": "onenet",
                "status": "sent",
                "requestedAt": now_ms - 1000,
                "sentAt": now_ms,
                "updatedAt": now_ms,
            }
        )

        with self.assertLogs("runtime-service", level="INFO") as logs:
            response = self.service.query_commands("nova_1", 10)

        event = json.loads(logs.records[-1].getMessage())
        self.assertEqual(response.cacheMeta["mode"], "cache_only_injected")
        self.assertEqual(event["event"], "runtime_query_commands")
        self.assertEqual(event["mode"], "cache_only_injected")
        self.assertEqual(event["commandCount"], 1)

    def test_query_command_detail_logs_cache_merge_mode(self) -> None:
        now_ms = int(time.time() * 1000)
        self.repository.prepend_command(
            RuntimeCommand(
                commandId="cmd_repo",
                logicalKey="nova_1",
                provider="onenet",
                status="pending",
                requestedAt=now_ms - 3000,
                sentParams={"test": 1},
            )
        )
        self.runtime_cache.set_command_state(
            {
                "commandId": "cmd_repo",
                "logicalKey": "nova_1",
                "provider": "onenet",
                "status": "sent",
                "sentAt": now_ms,
                "updatedAt": now_ms,
            }
        )

        with self.assertLogs("runtime-service", level="INFO") as logs:
            response = self.service.query_command_detail("cmd_repo")

        event = json.loads(logs.records[-1].getMessage())
        self.assertEqual(response.cacheMeta["mode"], "cache_merged")
        self.assertEqual(event["event"], "runtime_query_command_detail")
        self.assertEqual(event["mode"], "cache_merged")
        self.assertEqual(event["commandStatus"], "sent")


if __name__ == "__main__":
    unittest.main()
