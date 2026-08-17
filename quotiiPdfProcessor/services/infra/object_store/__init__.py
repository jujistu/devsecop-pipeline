"""ObjectStore module: thin blob-store seam backed by Cloudflare R2.

Exposes the interface plus concrete adapters (R2, in-memory fake), a factory,
and a thin Cloud-indexing write path so callers never touch raw S3 SDK details.

R2ObjectStore is imported lazily so fake/unit tests do not require boto3.
"""
from services.infra.object_store.base import ObjectStore
from services.infra.object_store.fake import FakeObjectStore
from services.infra.object_store.factory import get_object_store, store_book_context

__all__ = [
    "ObjectStore",
    "FakeObjectStore",
    "R2ObjectStore",
    "get_object_store",
    "store_book_context",
]


def __getattr__(name: str):
    if name == "R2ObjectStore":
        from services.infra.object_store.r2 import R2ObjectStore

        return R2ObjectStore
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
