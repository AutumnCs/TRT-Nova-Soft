import unittest

from app.repositories import MemoryRuntimeRepository, create_runtime_repository, _parse_mysql_dsn


class RuntimeRepositoryFactoryTests(unittest.TestCase):
    def test_create_memory_repository(self) -> None:
        repository = create_runtime_repository("memory")
        self.assertIsInstance(repository, MemoryRuntimeRepository)

    def test_parse_mysql_dsn(self) -> None:
        parsed = _parse_mysql_dsn("mysql://nova:secret@127.0.0.1:3306/trt_nova?charset=utf8mb4")
        self.assertEqual(parsed["host"], "127.0.0.1")
        self.assertEqual(parsed["port"], 3306)
        self.assertEqual(parsed["user"], "nova")
        self.assertEqual(parsed["database"], "trt_nova")
        self.assertEqual(parsed["charset"], "utf8mb4")


if __name__ == "__main__":
    unittest.main()
