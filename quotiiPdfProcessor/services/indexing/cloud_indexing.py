"""Cloud indexing seam: pdf-inspector (text) + Docling OCR (scanned/mixed).

Accepts an indexing job → classify/extract → durable Book context via
ObjectStore → Mongo ``indexStatus`` transitions (queued → processing → ready /
failed). Quote extraction is intentionally out of scope; ``ready`` means Book
context exists for Book AI.

Hybrid extract: keep inspector ``page-N.md`` for text pages; Docling overwrites
OCR pages (per-page when sparse; one full convert when OCR covers every page).

Extract adapters are injectable so tests can fake Docling without running OCR.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional, Protocol

from services.domain.indexStatus import IndexStatus
from services.infra.env import Env
from services.infra.object_store import ObjectStore, store_book_context
from services.pdf.pdfInspectorExtractor import extract_pages_with_inspector


class BooksCollection(Protocol):
    def update_one(self, filter, update, **kwargs): ...
    def insert_one(self, document): ...
    def find_one(self, filter, *args, **kwargs): ...


class BooksDb(Protocol):
    books: BooksCollection


ExtractFn = Callable[..., object]


def _default_ocr_extract(pdf_path, job_id, base_dir="outputs", pages=None):
    """Lazy default so Docling is not imported until a scanned/mixed job needs it."""
    from services.pdf.doclingOcrExtractor import extract_pages_with_docling_ocr

    return extract_pages_with_docling_ocr(
        pdf_path, job_id, base_dir=base_dir, pages=pages
    )


def source_object_key(user_id: str, job_id: str) -> str:
    return f"books/{user_id}/{job_id}/source.pdf"


def _set_index_status(
    db: BooksDb,
    job_id: str,
    status: IndexStatus,
    *,
    extra: Optional[dict] = None,
) -> None:
    fields = {"indexStatus": status.value, **(extra or {})}
    db.books.update_one({"jobId": str(job_id)}, {"$set": fields})


def _load_page_texts(out_dir: Path) -> list[tuple[int, str]]:
    """Read ``page-N.md`` files as ``(N, text)`` from the filename, not list index."""
    loaded: list[tuple[int, str]] = []
    for path in out_dir.glob("page-*.md"):
        suffix = path.stem.split("-", 1)[-1]
        try:
            page = int(suffix)
        except ValueError:
            continue
        loaded.append((page, path.read_text(encoding="utf-8")))
    loaded.sort(key=lambda item: item[0])
    return loaded


def enqueue_cloud_index(
    *,
    db: BooksDb,
    object_store: ObjectStore,
    user_id: str,
    job_id: str,
    title: str,
    pdf_bytes: bytes,
) -> dict:
    """Persist the source PDF, insert a queued book row, return the job snapshot.

    Does not run extraction — caller schedules ``run_cloud_index`` in the background
    so the HTTP response (and Reader open) is never blocked on indexing.
    """
    src_key = source_object_key(user_id, job_id)
    object_store.put(src_key, pdf_bytes, content_type="application/pdf")

    doc = {
        "jobId": str(job_id),
        "userId": user_id,
        "title": title,
        "indexStatus": IndexStatus.QUEUED.value,
        "indexError": None,
        "contextObjectKey": None,
        "sourceObjectKey": src_key,
        "createdAt": datetime.now(),
    }
    inserted = db.books.insert_one(doc)
    return {
        "job_id": str(job_id),
        "index_status": IndexStatus.QUEUED.value,
        "book_id": str(inserted.inserted_id) if hasattr(inserted, "inserted_id") else None,
    }


def run_cloud_index(
    *,
    db: BooksDb,
    object_store: ObjectStore,
    user_id: str,
    job_id: str,
    pdf_path: Optional[Path] = None,
    extract_fn: ExtractFn = extract_pages_with_inspector,
    ocr_extract_fn: Optional[ExtractFn] = None,
    work_dir: Optional[Path] = None,
) -> IndexStatus:
    """Run indexing to ready / failed. Testable with FakeObjectStore + OCR fakes."""
    _set_index_status(db, job_id, IndexStatus.PROCESSING, extra={"indexError": None})

    tmp_dir: Optional[Path] = None
    base_dir = str(work_dir) if work_dir is not None else "outputs"
    job_out = Path(base_dir) / str(job_id)
    try:
        local_pdf = pdf_path
        if local_pdf is None:
            src_key = source_object_key(user_id, job_id)
            pdf_bytes = object_store.get(src_key)
            if pdf_bytes is None:
                raise FileNotFoundError(f"Source PDF missing at {src_key}")
            tmp_dir = Path(tempfile.mkdtemp(prefix=f"index-{job_id}-"))
            local_pdf = tmp_dir / "source.pdf"
            local_pdf.write_bytes(pdf_bytes)

        result = extract_fn(local_pdf, job_id, base_dir=base_dir)
        # Keep inspector page-N.md files; Docling only overwrites OCR pages.
        out_dir = Path(os.fspath(result))
        pdf_type = getattr(result, "pdf_type", None)
        if pdf_type is None:
            pdf_type, _ = result

        ocr_pages = getattr(result, "pages_needing_ocr", None)
        if ocr_pages is None:
            _, ocr_pages = result
        # Legacy fakes may pass a bool; treat True as "OCR whole dir via adapter".
        if isinstance(ocr_pages, bool):
            pages_arg = None if ocr_pages else []
            needs_ocr = ocr_pages
        else:
            pages_arg = list(ocr_pages or [])
            needs_ocr = bool(pages_arg)

        if needs_ocr:
            ocr_fn = ocr_extract_fn or _default_ocr_extract
            ocr_fn(local_pdf, job_id, base_dir=base_dir, pages=pages_arg)

        page_texts = _load_page_texts(out_dir)
        if not page_texts:
            raise ValueError("No page text extracted from PDF")

        context_key = store_book_context(
            user_id, job_id, page_texts, object_store=object_store
        )
        _set_index_status(
            db,
            job_id,
            IndexStatus.READY,
            extra={
                "contextObjectKey": context_key,
                "indexError": None,
                "pdfType": pdf_type,
            },
        )
        return IndexStatus.READY
    except Exception as exc:
        message = str(exc) or "Cloud indexing failed"
        _set_index_status(
            db,
            job_id,
            IndexStatus.FAILED,
            extra={
                "indexError": message,
            },
        )
        return IndexStatus.FAILED
    finally:
        if tmp_dir is not None:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        # Durable text lives in R2; scrub local extract dirs in prod only.
        if Env.is_production():
            shutil.rmtree(job_out, ignore_errors=True)


async def cloud_index_job(ctx, user_id: str, job_id: str) -> IndexStatus:
    """arq task: run Cloud indexing with production Mongo/R2 wiring.

    ``ctx`` is the arq job context (first positional arg by arq convention).
    Enqueued by the API layer (``services.queue.enqueue_cloud_index_job``) and
    consumed by the arq worker (``worker.py``). Lazy imports keep Mongo/R2
    construction inside the worker process. Docling/OCR is sync and CPU-bound,
    so it runs in a thread via ``asyncio.to_thread``.
    """
    from services.infra.db import get_mongo_db
    from services.infra.object_store import get_object_store

    return await asyncio.to_thread(
        run_cloud_index,
        db=get_mongo_db(),
        object_store=get_object_store(),
        user_id=user_id,
        job_id=job_id,
    )


def prepare_retry_cloud_index(
    *,
    db: BooksDb,
    object_store: ObjectStore,
    job_id: str,
) -> dict:
    """Validate stored source PDF and mark the job queued for a retry.

    Returns ``{"user_id", "job_id"}``. Does not run extraction — HTTP enqueues
    ``cloud_index_job``; tests call ``retry_cloud_index`` which runs the pipeline.
    """
    book = db.books.find_one({"jobId": str(job_id)})
    if not book:
        raise ValueError(f"No indexing job for jobId={job_id}")

    user_id = book["userId"]
    src_key = book.get("sourceObjectKey") or source_object_key(user_id, job_id)
    if not object_store.exists(src_key):
        raise FileNotFoundError(f"Source PDF missing at {src_key}; re-upload required")

    _set_index_status(
        db,
        job_id,
        IndexStatus.QUEUED,
        extra={"indexError": None, "contextObjectKey": None},
    )
    return {"user_id": user_id, "job_id": str(job_id)}


def retry_cloud_index(
    *,
    db: BooksDb,
    object_store: ObjectStore,
    job_id: str,
    extract_fn: ExtractFn = extract_pages_with_inspector,
    ocr_extract_fn: Optional[ExtractFn] = None,
    work_dir: Optional[Path] = None,
) -> IndexStatus:
    """Re-enter the indexing pipeline sync (tests / in-process callers)."""
    snap = prepare_retry_cloud_index(
        db=db, object_store=object_store, job_id=job_id
    )
    return run_cloud_index(
        db=db,
        object_store=object_store,
        user_id=snap["user_id"],
        job_id=snap["job_id"],
        extract_fn=extract_fn,
        ocr_extract_fn=ocr_extract_fn,
        work_dir=work_dir,
    )
