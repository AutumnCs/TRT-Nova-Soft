import time
import unittest

from app.config import RuntimeConfig
from app.models import RuntimeCommand, UnifiedDeviceMessage
from app.providers import MockCommandProvider
from app.repositories import MemoryRuntimeRepository
from app.runtime_cache import MemoryRuntimeCache
from app.services import RuntimeService


class RecordingMemoryRuntimeRepository(MemoryRuntimeRepository):
    def __init__(self) -> None:
        super().__init__()
        self.get_latest_state_calls = 0
        self.list_commands_calls = 0

    def get_latest_state(self, logical_key: str):
        self.get_latest_state_calls += 1
        return super().get_latest_state(logical_key)

    def list_commands(self, logical_key: str, limit: int):
        self.list_commands_calls += 1
        return super().list_commands(logical_key, limit)


class RuntimeServiceLatestTests(unittest.TestCase):
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

    def _message(self, *, logical_key: str = "nova_1", timestamp: int, temp: int = 24, humidity: int = 65, soil: int = 48):
        return UnifiedDeviceMessage(
            provider="onenet",
            deviceId=logical_key,
            logicalKey=logical_key,
            productId="prod_1",
            deviceName="Nova_01",
            messageId=f"msg_{timestamp}",
            timestamp=timestamp,
            type="property",
            payload={
                "params": {
                    "dht_temp": {"value": temp, "time": timestamp},
                    "dht_humi": {"value": humidity, "time": timestamp},
                    "soil_percent": {"value": soil, "time": timestamp},
                    "test": {"value": 1, "time": timestamp},
                }
            },
        )

    def test_query_latest_uses_repository_fact_by_default(self) -> None:
        now_ms = int(time.time() * 1000)
        self.repository.save_latest_state(self._message(timestamp=now_ms - 1000))

        response = self.service.query_latest("nova_1")

        self.assertTrue(response.online)
        self.assertEqual(response.onlineStatus, "online")
        self.assertEqual(response.productId, "prod_1")
        self.assertEqual(response.deviceName, "Nova_01")
        self.assertEqual(response.params["dht_temp"]["value"], 24)
        self.assertEqual(response.sensorSnapshot["temp"]["value"], 24)
        self.assertEqual(response.sensorSnapshot["humidity"]["value"], 65)
        self.assertEqual(response.cacheMeta["latestSource"], "memory")
        self.assertEqual(response.cacheMeta["onlineSource"], "memory")

    def test_query_latest_prefers_fresher_cache_snapshot(self) -> None:
        now_ms = int(time.time() * 1000)
        self.repository.save_latest_state(self._message(timestamp=now_ms - 20_000, temp=24))
        self.runtime_cache.set_latest_state(
            {
                "logicalKey": "nova_1",
                "provider": "onenet",
                "productId": "prod_1",
                "deviceName": "Nova_01",
                "updatedAt": now_ms - 1_000,
                "payload": {
                    "params": {
                        "dht_temp": {"value": 30, "time": now_ms - 1_000},
                        "dht_humi": {"value": 70, "time": now_ms - 1_000},
                    }
                },
            }
        )

        response = self.service.query_latest("nova_1")

        self.assertEqual(response.updatedAt, now_ms - 1_000)
        self.assertEqual(response.sensorSnapshot["temp"]["value"], 30)
        self.assertEqual(response.sensorSnapshot["humidity"]["value"], 70)
        self.assertEqual(response.cacheMeta["latestSource"], "memory")

    def test_query_latest_uses_cache_online_override(self) -> None:
        now_ms = int(time.time() * 1000)
        self.repository.save_latest_state(self._message(timestamp=now_ms - 1_000))
        self.runtime_cache.set_online_state(
            {
                "logicalKey": "nova_1",
                "online": False,
                "offline": True,
                "onlineStatus": "offline",
                "lastSeenAt": now_ms - 100_000,
                "offlineSinceMs": now_ms - 100_000 + self.service.config.device_offline_timeout_ms,
            }
        )

        response = self.service.query_latest("nova_1")

        self.assertFalse(response.online)
        self.assertTrue(response.offline)
        self.assertEqual(response.onlineStatus, "offline")
        self.assertEqual(response.cacheMeta["onlineSource"], "memory")

    def test_query_latest_uses_cache_command_when_repository_has_none(self) -> None:
        now_ms = int(time.time() * 1000)
        self.repository.save_latest_state(self._message(timestamp=now_ms - 1_000))
        self.runtime_cache.set_command_state(
            {
                "commandId": "cmd_123",
                "logicalKey": "nova_1",
                "provider": "onenet",
                "status": "sent",
                "updatedAt": now_ms,
            }
        )

        response = self.service.query_latest("nova_1")

        self.assertTrue(response.controlSnapshot["fan"]["pending"])
        self.assertEqual(response.controlSnapshot["fan"]["latestCommandId"], "cmd_123")
        self.assertEqual(response.controlSnapshot["fan"]["latestCommandStatus"], "sent")

    def test_query_latest_prefers_repository_command_when_it_is_newer(self) -> None:
        now_ms = int(time.time() * 1000)
        self.repository.save_latest_state(self._message(timestamp=now_ms - 1_000))
        self.repository.prepend_command(
            RuntimeCommand(
                commandId="cmd_repo",
                logicalKey="nova_1",
                provider="onenet",
                status="done",
                requestedAt=now_ms,
                doneAt=now_ms,
                sentParams={"test": 0},
            )
        )
        self.runtime_cache.set_command_state(
            {
                "commandId": "cmd_cache",
                "logicalKey": "nova_1",
                "provider": "onenet",
                "status": "sent",
                "updatedAt": now_ms - 5_000,
            }
        )

        response = self.service.query_latest("nova_1")

        self.assertFalse(response.controlSnapshot["fan"]["pending"])
        self.assertEqual(response.controlSnapshot["fan"]["latestCommandId"], "cmd_repo")
        self.assertEqual(response.controlSnapshot["fan"]["latestCommandStatus"], "done")
        self.assertEqual(response.latestCommand["commandId"], "cmd_repo")
        self.assertEqual(response.latestCommand["requestedAt"], now_ms)

    def test_query_latest_backfills_latest_and_online_cache_from_repository(self) -> None:
        now_ms = int(time.time() * 1000)
        self.repository.save_latest_state(self._message(timestamp=now_ms - 1_000))

        response = self.service.query_latest("nova_1")
        cache_latest = self.runtime_cache.get_latest_state("nova_1")
        cache_online = self.runtime_cache.get_online_state("nova_1")

        self.assertTrue(response.online)
        self.assertEqual(cache_latest["logicalKey"], "nova_1")
        self.assertEqual(cache_latest["updatedAt"], now_ms - 1_000)
        self.assertEqual(cache_online["onlineStatus"], "online")
        self.assertEqual(cache_online["lastSeenAt"], now_ms - 1_000)

    def test_query_latest_uses_cache_without_repository_latest_lookup_when_snapshot_exists(self) -> None:
        repository = RecordingMemoryRuntimeRepository()
        runtime_cache = MemoryRuntimeCache()
        service = RuntimeService(
            config=RuntimeConfig(
                storage_backend="memory",
                runtime_cache_backend="memory",
                command_provider_backend="mock",
                device_offline_timeout_ms=10 * 60 * 1000,
            ),
            repository=repository,
            runtime_cache=runtime_cache,
            command_provider=MockCommandProvider(),
        )
        now_ms = int(time.time() * 1000)
        runtime_cache.set_latest_state(
            {
                "logicalKey": "nova_1",
                "provider": "onenet",
                "productId": "prod_1",
                "deviceName": "Nova_01",
                "updatedAt": now_ms,
                "payload": {
                    "params": {
                        "dht_temp": {"value": 28, "time": now_ms},
                    }
                },
            }
        )

        response = service.query_latest("nova_1")

        self.assertEqual(response.sensorSnapshot["temp"]["value"], 28)
        self.assertEqual(repository.get_latest_state_calls, 0)

    def test_query_latest_backfills_latest_command_cache_from_repository_when_missing(self) -> None:
        now_ms = int(time.time() * 1000)
        self.repository.save_latest_state(self._message(timestamp=now_ms - 1_000))
        self.repository.prepend_command(
            RuntimeCommand(
                commandId="cmd_repo_backfill",
                logicalKey="nova_1",
                provider="onenet",
                status="done",
                requestedAt=now_ms - 500,
                doneAt=now_ms,
                sentParams={"test": 0},
            )
        )

        response = self.service.query_latest("nova_1")
        cache_command = self.runtime_cache.get_latest_command_state("nova_1")

        self.assertEqual(response.latestCommand["commandId"], "cmd_repo_backfill")
        self.assertEqual(cache_command["commandId"], "cmd_repo_backfill")
        self.assertEqual(cache_command["status"], "done")


if __name__ == "__main__":
    unittest.main()
