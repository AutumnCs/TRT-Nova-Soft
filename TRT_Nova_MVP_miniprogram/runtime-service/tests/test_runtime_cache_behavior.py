import unittest

from app.runtime_cache import MemoryRuntimeCache, RuntimeCacheState


class MemoryRuntimeCacheBehaviorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.state = RuntimeCacheState()
        self.cache = MemoryRuntimeCache(state=self.state, key_prefix="trt:nova")

    def test_set_command_state_updates_both_command_and_latest_views(self) -> None:
        payload = {
            "commandId": "cmd-001",
            "logicalKey": "device:plant-001",
            "status": "acked",
            "action": "setFan",
            "ts": 1721000000000,
        }

        result = self.cache.set_command_state(payload)

        self.assertTrue(result)
        self.assertEqual(self.cache.get_command_state("cmd-001"), payload)
        self.assertEqual(self.cache.get_latest_command_state("device:plant-001"), payload)

    def test_set_command_processing_then_clear_removes_processing_marker(self) -> None:
        payload = {
            "commandId": "cmd-002",
            "logicalKey": "device:plant-002",
            "status": "processing",
            "startedAt": 1721000001000,
        }

        self.assertTrue(self.cache.set_command_processing(payload))
        self.assertEqual(self.state.processing_by_command_id["cmd-002"], payload)

        self.assertTrue(self.cache.clear_command_processing("cmd-002"))
        self.assertNotIn("cmd-002", self.state.processing_by_command_id)

    def test_mark_message_dedup_records_device_and_message_key(self) -> None:
        payload = {
            "logicalKey": "device:plant-003",
            "ts": 1721000002000,
        }

        result = self.cache.mark_message_dedup("plant-003", "msg-abc", payload)

        self.assertTrue(result)
        self.assertIn("plant-003:msg-abc", self.state.dedup_by_key)
        self.assertTrue(self.cache.has_message_dedup("plant-003", "msg-abc"))
        self.assertFalse(self.cache.has_message_dedup("plant-003", "msg-missing"))

    def test_latest_and_online_state_round_trip_by_logical_key(self) -> None:
        latest_payload = {
            "logicalKey": "device:plant-004",
            "temperature": 24.6,
            "humidity": 61,
            "ts": 1721000003000,
        }
        online_payload = {
            "logicalKey": "device:plant-004",
            "isOnline": True,
            "lastSeenAt": 1721000003000,
        }

        self.assertTrue(self.cache.set_latest_state(latest_payload))
        self.assertTrue(self.cache.set_online_state(online_payload))

        self.assertEqual(self.cache.get_latest_state("device:plant-004"), latest_payload)
        self.assertEqual(self.cache.get_online_state("device:plant-004"), online_payload)


if __name__ == "__main__":
    unittest.main()
