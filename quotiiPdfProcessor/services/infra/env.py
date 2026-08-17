"""Shared process env parsing for the PdfProcessor API + arq worker."""
from __future__ import annotations

import os


class Env:
    """Thin helpers over ``os.environ`` — one place for APP_ENV and friends."""

    @staticmethod
    def get(key: str, default: str = "") -> str:
        return (os.getenv(key, default) or default).strip()

    @classmethod
    def app_env(cls) -> str:
        """Normalized APP_ENV; defaults to ``development``."""
        return (cls.get("APP_ENV", "development") or "development").lower()

    @classmethod
    def is_production(cls) -> bool:
        return cls.app_env() in ("production", "prod")

    @classmethod
    def is_development(cls) -> bool:
        return not cls.is_production()
