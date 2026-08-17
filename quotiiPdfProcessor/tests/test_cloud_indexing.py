"""Cloud indexing seam tests — FakeObjectStore only (no live R2 / Docling)."""
import sys
import os
import tempfile
import shutil
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.domain.indexStatus import IndexStatus
from services.infra.object_store.fake import FakeObjectStore
from services.indexing.cloud_indexing import (
    enqueue_cloud_index,
    retry_cloud_index,
    run_cloud_index,
    source_object_key,
)


class FakeInsertResult:
    def __init__(self, inserted_id="book-oid-1"):
        self.inserted_id = inserted_id


class FakeBooksCollection:
    def __init__(self):
        self._docs = {}

    def insert_one(self, document):
        self._docs[document["jobId"]] = dict(document)
        return FakeInsertResult()

    def update_one(self, filter, update, **kwargs):
        job_id = filter["jobId"]
        doc = self._docs.setdefault(job_id, {"jobId": job_id})
        doc.update(update.get("$set", {}))
        return MagicMock(modified_count=1)

    def find_one(self, filter, *args, **kwargs):
        return self._docs.get(filter.get("jobId"))


class FakeBooksDb:
    """Minimal in-memory Mongo stand-in for the indexing seam."""

    def __init__(self):
        self.books = FakeBooksCollection()


class _FakeExtractResult:
    def __init__(self, out_dir: Path, pdf_type: str, pages_needing_ocr):
        self.out_dir = out_dir
        self.pdf_type = pdf_type
        self.pages_needing_ocr = pages_needing_ocr

    def __fspath__(self):
        return os.fspath(self.out_dir)

    def __iter__(self):
        return iter((self.pdf_type, self.pages_needing_ocr))


def _write_pages(out_dir: Path, texts):
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, text in enumerate(texts, start=1):
        (out_dir / f"page-{i}.md").write_text(text, encoding="utf-8")


class TestCloudIndexingSeam(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.store = FakeObjectStore()
        self.db = FakeBooksDb()
        self.user_id = "user-1"
        self.job_id = "job-text-1"
        self.pdf_bytes = b"%PDF-1.4 fake text pdf"

    def test_enqueue_sets_queued_and_stores_source_pdf(self):
        snap = enqueue_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            title="Sample",
            pdf_bytes=self.pdf_bytes,
        )

        self.assertEqual(snap["index_status"], IndexStatus.QUEUED.value)
        book = self.db.books.find_one({"jobId": self.job_id})
        self.assertEqual(book["indexStatus"], "queued")
        self.assertEqual(book["title"], "Sample")
        self.assertNotIn("documentId", book)
        self.assertNotIn("status", book)
        self.assertNotIn("quoteCount", book)
        self.assertEqual(
            self.store.get(source_object_key(self.user_id, self.job_id)),
            self.pdf_bytes,
        )

    def test_text_pdf_reaches_ready_with_book_context(self):
        enqueue_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            title="Sample",
            pdf_bytes=self.pdf_bytes,
        )

        out_dir = Path(self.tmp) / self.job_id
        ocr_calls = {"n": 0}

        def fake_extract(pdf_path, job_id, base_dir="outputs"):
            _write_pages(out_dir, ["page one", "page two"])
            return _FakeExtractResult(out_dir, "text_based", [])

        def fake_ocr(*args, **kwargs):
            ocr_calls["n"] += 1
            raise AssertionError("OCR adapter must not run for text_based PDFs")

        status = run_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            extract_fn=fake_extract,
            ocr_extract_fn=fake_ocr,
            work_dir=Path(self.tmp),
        )

        self.assertEqual(status, IndexStatus.READY)
        self.assertEqual(ocr_calls["n"], 0)
        book = self.db.books.find_one({"jobId": self.job_id})
        self.assertEqual(book["indexStatus"], "ready")
        self.assertEqual(book["contextObjectKey"], f"books/{self.user_id}/{self.job_id}/context.md")
        self.assertEqual(
            self.store.get(book["contextObjectKey"]),
            b"<!-- page:1 -->\npage one\n\n<!-- page:2 -->\npage two",
        )
        self.assertNotIn("status", book)
        self.assertNotIn("quoteCount", book)

    def test_extract_failure_sets_failed(self):
        enqueue_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            title="Sample",
            pdf_bytes=self.pdf_bytes,
        )

        def boom(*args, **kwargs):
            raise RuntimeError("inspector exploded")

        status = run_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            extract_fn=boom,
            work_dir=Path(self.tmp),
        )

        self.assertEqual(status, IndexStatus.FAILED)
        book = self.db.books.find_one({"jobId": self.job_id})
        self.assertEqual(book["indexStatus"], "failed")
        self.assertIn("inspector exploded", book["indexError"])

    def test_scanned_pdf_routes_to_ocr_adapter_and_reaches_ready(self):
        enqueue_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            title="Scan",
            pdf_bytes=self.pdf_bytes,
        )
        out_dir = Path(self.tmp) / self.job_id
        ocr_calls = {"n": 0, "pdf_path": None}

        def scanned_extract(pdf_path, job_id, base_dir="outputs"):
            out_dir.mkdir(parents=True, exist_ok=True)
            # Inspector may leave empty/sparse pages for scanned PDFs.
            (out_dir / "page-1.md").write_text("", encoding="utf-8")
            (out_dir / "page-2.md").write_text("", encoding="utf-8")
            return _FakeExtractResult(out_dir, "scanned", [1, 2])

        def fake_docling_ocr(pdf_path, job_id, base_dir="outputs", pages=None):
            ocr_calls["n"] += 1
            ocr_calls["pdf_path"] = pdf_path
            ocr_calls["pages"] = pages
            _write_pages(Path(base_dir) / str(job_id), ["ocr page one", "ocr page two"])
            return Path(base_dir) / str(job_id)

        status = run_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            extract_fn=scanned_extract,
            ocr_extract_fn=fake_docling_ocr,
            work_dir=Path(self.tmp),
        )

        self.assertEqual(status, IndexStatus.READY)
        self.assertEqual(ocr_calls["n"], 1)
        self.assertEqual(ocr_calls["pages"], [1, 2])
        self.assertIsNotNone(ocr_calls["pdf_path"])
        book = self.db.books.find_one({"jobId": self.job_id})
        self.assertEqual(book["indexStatus"], "ready")
        self.assertEqual(book["pdfType"], "scanned")
        self.assertIsNone(book["indexError"])
        self.assertEqual(
            self.store.get(book["contextObjectKey"]),
            b"<!-- page:1 -->\nocr page one\n\n<!-- page:2 -->\nocr page two",
        )

    def test_mixed_pdf_routes_to_ocr_adapter(self):
        enqueue_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            title="Mixed",
            pdf_bytes=self.pdf_bytes,
        )
        out_dir = Path(self.tmp) / self.job_id
        routed = {"ocr": False, "pages": None}

        def mixed_extract(pdf_path, job_id, base_dir="outputs"):
            _write_pages(out_dir, ["", "inspector text page", ""])
            return _FakeExtractResult(out_dir, "mixed", [1, 3])

        def fake_ocr(pdf_path, job_id, base_dir="outputs", pages=None):
            routed["ocr"] = True
            routed["pages"] = pages
            # Overwrite only OCR pages; keep inspector text on page 2.
            job_dir = Path(base_dir) / str(job_id)
            (job_dir / "page-1.md").write_text("ocr one", encoding="utf-8")
            (job_dir / "page-3.md").write_text("ocr three", encoding="utf-8")
            return job_dir

        status = run_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            extract_fn=mixed_extract,
            ocr_extract_fn=fake_ocr,
            work_dir=Path(self.tmp),
        )

        self.assertEqual(status, IndexStatus.READY)
        self.assertTrue(routed["ocr"])
        self.assertEqual(routed["pages"], [1, 3])
        book = self.db.books.find_one({"jobId": self.job_id})
        self.assertEqual(book["pdfType"], "mixed")
        self.assertEqual(
            self.store.get(book["contextObjectKey"]),
            b"<!-- page:1 -->\nocr one\n\n<!-- page:2 -->\ninspector text page\n\n<!-- page:3 -->\nocr three",
        )

    def test_ocr_adapter_failure_sets_failed(self):
        enqueue_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            title="Scan",
            pdf_bytes=self.pdf_bytes,
        )
        out_dir = Path(self.tmp) / self.job_id

        def scanned_extract(pdf_path, job_id, base_dir="outputs"):
            out_dir.mkdir(parents=True, exist_ok=True)
            return _FakeExtractResult(out_dir, "image_based", [1])

        def boom_ocr(*args, **kwargs):
            raise RuntimeError("docling ocr failed")

        status = run_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            extract_fn=scanned_extract,
            ocr_extract_fn=boom_ocr,
            work_dir=Path(self.tmp),
        )

        self.assertEqual(status, IndexStatus.FAILED)
        book = self.db.books.find_one({"jobId": self.job_id})
        self.assertIn("docling ocr failed", book["indexError"])

    def test_retry_from_failed_reenters_pipeline_to_ready(self):
        enqueue_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            title="Sample",
            pdf_bytes=self.pdf_bytes,
        )

        # First pass fails.
        def boom(*args, **kwargs):
            raise RuntimeError("transient")

        self.assertEqual(
            run_cloud_index(
                db=self.db,
                object_store=self.store,
                user_id=self.user_id,
                job_id=self.job_id,
                extract_fn=boom,
                work_dir=Path(self.tmp),
            ),
            IndexStatus.FAILED,
        )

        out_dir = Path(self.tmp) / self.job_id
        calls = {"n": 0}

        def ok_extract(pdf_path, job_id, base_dir="outputs"):
            calls["n"] += 1
            _write_pages(out_dir, ["recovered page"])
            return _FakeExtractResult(out_dir, "text_based", False)

        status = retry_cloud_index(
            db=self.db,
            object_store=self.store,
            job_id=self.job_id,
            extract_fn=ok_extract,
            work_dir=Path(self.tmp),
        )

        self.assertEqual(status, IndexStatus.READY)
        self.assertEqual(calls["n"], 1)
        book = self.db.books.find_one({"jobId": self.job_id})
        self.assertEqual(book["indexStatus"], "ready")
        self.assertIsNone(book["indexError"])
        self.assertEqual(
            self.store.get(book["contextObjectKey"]),
            b"<!-- page:1 -->\nrecovered page",
        )

    def test_prod_deletes_job_output_dir(self):
        enqueue_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            title="Sample",
            pdf_bytes=self.pdf_bytes,
        )
        out_dir = Path(self.tmp) / self.job_id

        def fake_extract(pdf_path, job_id, base_dir="outputs"):
            _write_pages(out_dir, ["page one"])
            return _FakeExtractResult(out_dir, "text_based", False)

        with patch.dict(os.environ, {"APP_ENV": "production"}):
            status = run_cloud_index(
                db=self.db,
                object_store=self.store,
                user_id=self.user_id,
                job_id=self.job_id,
                extract_fn=fake_extract,
                work_dir=Path(self.tmp),
            )

        self.assertEqual(status, IndexStatus.READY)
        self.assertFalse(out_dir.exists())
        book = self.db.books.find_one({"jobId": self.job_id})
        self.assertEqual(
            self.store.get(book["contextObjectKey"]),
            b"<!-- page:1 -->\npage one",
        )

    def test_dev_keeps_job_output_dir(self):
        enqueue_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            title="Sample",
            pdf_bytes=self.pdf_bytes,
        )
        out_dir = Path(self.tmp) / self.job_id

        def fake_extract(pdf_path, job_id, base_dir="outputs"):
            _write_pages(out_dir, ["page one"])
            return _FakeExtractResult(out_dir, "text_based", False)

        with patch.dict(os.environ, {"APP_ENV": "development"}):
            status = run_cloud_index(
                db=self.db,
                object_store=self.store,
                user_id=self.user_id,
                job_id=self.job_id,
                extract_fn=fake_extract,
                work_dir=Path(self.tmp),
            )

        self.assertEqual(status, IndexStatus.READY)
        self.assertTrue(out_dir.exists())

    def test_page_markers_use_filename_numbers_not_enumerate(self):
        enqueue_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            title="Gapped",
            pdf_bytes=self.pdf_bytes,
        )
        out_dir = Path(self.tmp) / self.job_id

        def gapped_extract(pdf_path, job_id, base_dir="outputs"):
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "page-1.md").write_text("first", encoding="utf-8")
            (out_dir / "page-3.md").write_text("third", encoding="utf-8")
            return _FakeExtractResult(out_dir, "text_based", [])

        status = run_cloud_index(
            db=self.db,
            object_store=self.store,
            user_id=self.user_id,
            job_id=self.job_id,
            extract_fn=gapped_extract,
            work_dir=Path(self.tmp),
        )

        self.assertEqual(status, IndexStatus.READY)
        book = self.db.books.find_one({"jobId": self.job_id})
        self.assertEqual(
            self.store.get(book["contextObjectKey"]),
            b"<!-- page:1 -->\nfirst\n\n<!-- page:3 -->\nthird",
        )


class TestCloudIndexJob(unittest.TestCase):
    """arq task seam: stable job name + production Mongo/R2 wiring."""

    def setUp(self):
        self.store = FakeObjectStore()
        self.db = FakeBooksDb()
        self.job_id = "job-text-1"

    def test_cloud_index_job_name_is_stable(self):
        from services.indexing.cloud_indexing import cloud_index_job

        # services.queue.enqueue_cloud_index_job enqueues by this exact name.
        self.assertEqual(cloud_index_job.__name__, "cloud_index_job")

    @patch("services.indexing.cloud_indexing.run_cloud_index")
    @patch("services.infra.object_store.get_object_store")
    @patch("services.infra.db.get_mongo_db")
    def test_cloud_index_job_wires_db_and_store(self, mock_db, mock_store, mock_run):
        import asyncio

        from services.indexing.cloud_indexing import cloud_index_job

        mock_db.return_value = self.db
        mock_store.return_value = self.store

        # ctx is the arq job context — first positional arg by arq convention.
        asyncio.run(
            cloud_index_job(MagicMock(ctx_id="job-ctx"), user_id="u1", job_id=self.job_id)
        )

        mock_run.assert_called_once_with(
            db=self.db,
            object_store=self.store,
            user_id="u1",
            job_id=self.job_id,
        )


if __name__ == "__main__":
    unittest.main(argv=["first-arg-is-ignored"], exit=False)
