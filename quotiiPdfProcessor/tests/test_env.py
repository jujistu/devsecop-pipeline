"""Env util — APP_ENV parsing."""
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.infra.env import Env


class TestEnv(unittest.TestCase):
    def test_defaults_to_development(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("APP_ENV", None)
            self.assertEqual(Env.app_env(), "development")
            self.assertTrue(Env.is_development())
            self.assertFalse(Env.is_production())

    def test_production_aliases(self):
        for value in ("production", "Production", "prod", " PROD "):
            with self.subTest(value=value):
                with patch.dict(os.environ, {"APP_ENV": value}):
                    self.assertTrue(Env.is_production())
                    self.assertFalse(Env.is_development())

    def test_get_strips(self):
        with patch.dict(os.environ, {"REDIS_URL": "  redis://x  "}):
            self.assertEqual(Env.get("REDIS_URL"), "redis://x")


if __name__ == "__main__":
    unittest.main(argv=["first-arg-is-ignored"], exit=False)
