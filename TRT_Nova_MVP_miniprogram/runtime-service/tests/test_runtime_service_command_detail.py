import time
import unittest

from app.config import RuntimeConfig
from app.models import RuntimeCommand
from app.providers import MockCommandProvider
from app.repositories import MemoryRuntimeRepository
from app.runtime_cache import MemoryRuntimeCache
from app.services import RuntimeService


class RuntimeServiceCommandDetailTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = MemoryRuntimeRepository()
        self.runtime_cache = MemoryRuntimeCache()
        self.service = RuntimeService(
            config=RuntimeConfig(
                storage_backend="memory",
                runtime_cache_backend="memory",
                command_provider_backend="mock",
            ),
            repository=self.repository,
            runtime_cache=self.runtime_cache,
            command_provider=MockCommandProvider(),
        )

    def test_query_command_detail_uses_repository_command(self) -> None:
        now_ms = int(time.time() * 1000)
        self.repository.prepend_command(
            RuntimeCommand(
                commandId="cmd_repo",
                logicalKey="nova_1",
                productId="prod_1",
                deviceName="Nova_01",
                provider="onenet",
                status="done",
                requestedAt=now_ms,
                doneAt=now_ms,
                sentParams={"test": 1},
            )
        )

        response = self.service.query_command_detail("cmd_repo")

        self.assertTrue(response.success)
        self.assertEqual(response.command.commandId, "cmd_repo")
        self.assertEqual(response.command.status, "done")
        self.assertEqual(response.command.deviceName, "Nova_01")
        self.assertEqual(response.cacheMeta["mode"], "repo_only")
        self.assertEqual(response.cacheMeta["source"], "memory")
        self.assertEqual(response.cacheMeta["hits"], 0)

    def test_query_command_detail_merges_cache_state(self) -> None:
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

        response = self.service.query_command_detail("cmd_repo")

        self.assertTrue(response.success)
        self.assertEqual(response.command.status, "sent")
        self.assertEqual(response.command.sentAt, now_ms)
        self.assertEqual(response.cacheMeta["mode"], "cache_merged")
        self.assertEqual(response.cacheMeta["source"], "memory")
        self.assertEqual(response.cacheMeta["hits"], 1)

    def test_query_command_detail_uses_cache_only_when_repository_missing(self) -> None:
        now_ms = int(time.time() * 1000)
        self.runtime_cache.set_command_state(
            {
                "commandId": "cmd_cache",
                "logicalKey": "nova_1",
                "provider": "onenet",
                "status": "acked",
                "requestedAt": now_ms - 1000,
                "ackedAt": now_ms,
                "updatedAt": now_ms,
            }
        )

        response = self.service.query_command_detail("cmd_cache")

        self.assertTrue(response.success)
        self.assertEqual(response.command.commandId, "cmd_cache")
        self.assertEqual(response.command.status, "acked")
        self.assertEqual(response.command.ackedAt, now_ms)
        self.assertEqual(response.cacheMeta["mode"], "cache_only")
        self.assertEqual(response.cacheMeta["source"], "memory")


if __name__ == "__main__":
    unittest.main()
