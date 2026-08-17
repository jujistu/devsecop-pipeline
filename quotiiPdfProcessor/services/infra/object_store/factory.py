"""ObjectStore factory + the Cloud indexing thin spike write path.

``get_object_store`` returns a production R2 adapter when R2 env config is
present, otherwise an in-memory fake (safe default for tests/local dev).
"""
import os
from typing import Optional, Sequence

from services.infra.object_store.base import ObjectStore
from services.infra.object_store.fake import FakeObjectStore


def get_object_store() -> ObjectStore:
    """Construct the appropriate ObjectStore for the current environment."""
    if os.getenv("OBJECT_STORE", "").strip().lower() == "fake":
        return FakeObjectStore()
    try:
        # Lazy import: boto3 only needed when R2 config is present.
        from services.infra.object_store.r2 import R2ObjectStore

        return R2ObjectStore()
    except (ValueError, ImportError):
        # No R2 config (or boto3) available -> in-memory fake so callers/tests
        # never depend on live infrastructure details.
        return FakeObjectStore()


def store_book_context(
    user_id: str,
    job_id: str,
    page_texts: Sequence[tuple[int, str]],
    object_store: Optional[ObjectStore] = None,
) -> str:
    """Persist page-aware Book context Markdown through ObjectStore.

    Each item is ``(page, text)`` where ``page`` comes from ``page-N.md``.
    Stamps ``<!-- page:N -->`` so Book AI can ground citations. Returns the key.
    """
    store = object_store or get_object_store()
    key = f"books/{user_id}/{job_id}/context.md"
    parts = [f"<!-- page:{int(page)} -->\n{text}" for page, text in page_texts]
    data = "\n\n".join(parts).encode("utf-8")
    store.put(key, data, content_type="text/markdown")
    return key
