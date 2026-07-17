import unittest

from app.runtime_cache import MemoryRuntimeCache, NoopRuntimeCache, _parse_redis_url, create_runtime_cache


class RuntimeCacheFactoryTests(unittest.TestCase):
    def test_create_noop_cache(self) -> None:
        cache = create_runtime_cache("noop")
        self.assertIsInstance(cache, NoopRuntimeCache)

    def test_create_memory_cache(self) -> None:
        cache = create_runtime_cache("memory", key_prefix="trt:nova")
        self.assertIsInstance(cache, MemoryRuntimeCache)

    def test_parse_redis_url(self) -> None:
        parsed = _parse_redis_url("redis://:secret@127.0.0.1:6379/3")
        self.assertEqual(parsed["host"], "127.0.0.1")
        self.assertEqual(parsed["port"], 6379)
        self.assertEqual(parsed["db"], 3)


if __name__ == "__main__":
    unittest.main()
