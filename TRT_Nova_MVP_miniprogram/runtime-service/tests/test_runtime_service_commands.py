import time
import unittest

from app.config import RuntimeConfig
from app.models import RuntimeCommand
from app.providers import MockCommandProvider
from app.repositories import MemoryRuntimeRepository
from app.runtime_cache import MemoryRuntimeCache
from app.services import RuntimeService


class RuntimeServiceCommandsTests(unittest.TestCase):
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

    def test_query_commands_merges_cache_state_for_existing_command(self) -> None:
        now_ms = int(time.time() * 1000)
        self.repository.prepend_command(
            RuntimeCommand(
                commandId="cmd_repo",
                logicalKey="nova_1",
                provider="onenet",
                status="pending",
                requestedAt=now_ms - 2_000,
                sentParams={"fan_switch": True},
            )
        )
        self.runtime_cache.set_command_state(
            {
                "commandId": "cmd_repo",
                "logicalKey": "nova_1",
                "provider": "onenet",
                "status": "acked",
                "sentAt": now_ms - 1_000,
                "ackedAt": now_ms,
                "updatedAt": now_ms,
            }
        )

        response = self.service.query_commands("nova_1", 10)
        commands = response.commands

        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0].commandId, "cmd_repo")
        self.assertEqual(commands[0].status, "acked")
        self.assertEqual(commands[0].ackedAt, now_ms)
        self.assertEqual(response.cacheMeta["mode"], "cache_merged")
        self.assertEqual(response.cacheMeta["hits"], 1)

    def test_query_commands_includes_cache_only_latest_command_when_repository_is_empty(self) -> None:
        now_ms = int(time.time() * 1000)
        self.runtime_cache.set_command_state(
            {
                "commandId": "cmd_cache_only",
                "logicalKey": "nova_1",
                "provider": "onenet",
                "status": "sent",
                "requestedAt": now_ms - 1_000,
                "sentAt": now_ms,
                "updatedAt": now_ms,
                "sentParams": {"fan_switch": False},
            }
        )

        response = self.service.query_commands("nova_1", 10)
        commands = response.commands

        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0].commandId, "cmd_cache_only")
        self.assertEqual(commands[0].status, "sent")
        self.assertEqual(commands[0].sentAt, now_ms)
        self.assertEqual(response.cacheMeta["mode"], "cache_only_injected")
        self.assertEqual(response.cacheMeta["hits"], 1)

    def test_query_commands_respects_limit_after_cache_injection(self) -> None:
        now_ms = int(time.time() * 1000)
        self.repository.prepend_command(
            RuntimeCommand(
                commandId="cmd_repo_old",
                logicalKey="nova_1",
                provider="onenet",
                status="done",
                requestedAt=now_ms - 2_000,
                doneAt=now_ms - 1_500,
                sentParams={"fan_switch": True},
            )
        )
        self.runtime_cache.set_command_state(
            {
                "commandId": "cmd_cache_new",
                "logicalKey": "nova_1",
                "provider": "onenet",
                "status": "sent",
                "requestedAt": now_ms - 500,
                "sentAt": now_ms,
                "updatedAt": now_ms,
            }
        )

        response = self.service.query_commands("nova_1", 1)
        commands = response.commands

        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0].commandId, "cmd_cache_new")
        self.assertEqual(response.cacheMeta["mode"], "cache_only_injected")

    def test_query_commands_reports_repo_only_when_no_cache_state_exists(self) -> None:
        now_ms = int(time.time() * 1000)
        self.repository.prepend_command(
            RuntimeCommand(
                commandId="cmd_repo_only",
                logicalKey="nova_1",
                provider="onenet",
                status="done",
                requestedAt=now_ms,
                doneAt=now_ms,
                sentParams={"fan_switch": True},
            )
        )

        response = self.service.query_commands("nova_1", 10)

        self.assertEqual(len(response.commands), 1)
        self.assertEqual(response.commands[0].commandId, "cmd_repo_only")
        self.assertEqual(response.cacheMeta["mode"], "repo_only")
        self.assertEqual(response.cacheMeta["hits"], 0)


if __name__ == "__main__":
    unittest.main()
