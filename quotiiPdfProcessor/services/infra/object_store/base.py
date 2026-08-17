"""Thin ObjectStore seam.

Callers store/retrieve blobs through this interface. Vendor details (Cloudflare
R2 / S3-compatible) live only inside concrete adapters, never in calling code.
"""
from abc import ABC, abstractmethod


class ObjectStore(ABC):
    """Minimal blob store needed by Cloud indexing (PDFs, thumbnails, Book context)."""

    @abstractmethod
    def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
        """Write ``data`` at ``key`` (overwriting if present)."""

    @abstractmethod
    def get(self, key: str) -> bytes | None:
        """Return the bytes at ``key`` or ``None`` when missing."""

    @abstractmethod
    def delete(self, key: str) -> bool:
        """Delete ``key``. Return ``True`` if it existed and was removed."""

    @abstractmethod
    def exists(self, key: str) -> bool:
        """Return ``True`` when a blob exists at ``key``."""
