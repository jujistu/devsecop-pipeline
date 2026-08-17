import unittest
import sys
import os
from unittest.mock import patch

# Add the repo root to sys.path so `services.*` imports resolve (matches the
# convention used by the other test modules in this repo).
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.infra.object_store.base import ObjectStore
from services.infra.object_store.fake import FakeObjectStore
from services.infra.object_store.factory import store_book_context


class TestObjectStoreSeam(unittest.TestCase):
    def test_put_get_round_trip(self):
        store = FakeObjectStore()
        store.put("books/u1/b1/context.md", b"page one\n\npage two",
                  content_type="text/markdown")

        self.assertEqual(store.get("books/u1/b1/context.md"),
                         b"page one\n\npage two")
        self.assertTrue(store.exists("books/u1/b1/context.md"))

    def test_get_missing_returns_none(self):
        store = FakeObjectStore()
        self.assertIsNone(store.get("missing/key"))

    def test_exists_false_for_missing_key(self):
        store = FakeObjectStore()
        self.assertFalse(store.exists("missing/key"))

    def test_delete_removes_blob(self):
        store = FakeObjectStore()
        store.put("a/b", b"data")
        self.assertTrue(store.delete("a/b"))
        self.assertIsNone(store.get("a/b"))
        self.assertFalse(store.exists("a/b"))

    def test_delete_missing_returns_false(self):
        store = FakeObjectStore()
        self.assertFalse(store.delete("never/written"))

    def test_fake_adapter_conforms_to_interface(self):
        self.assertIsInstance(FakeObjectStore(), ObjectStore)

    def test_store_book_context_uses_object_store_seam(self):
        store = FakeObjectStore()
        key = store_book_context("u1", "job-1", [(1, "page one"), (3, "page three")],
                                 object_store=store)

        self.assertEqual(key, "books/u1/job-1/context.md")
        self.assertEqual(
            store.get(key),
            b"<!-- page:1 -->\npage one\n\n<!-- page:3 -->\npage three",
        )

    def test_store_book_context_defaults_to_factory_store(self):
        # Force the factory to use the in-memory fake so this test never needs
        # (or accidentally touches) live R2 even if R2 env vars are set locally.
        with patch.dict(os.environ, {"OBJECT_STORE": "fake"}, clear=False):
            key = store_book_context("u2", "job-2", [(1, "only page")])
            self.assertEqual(key, "books/u2/job-2/context.md")


if __name__ == "__main__":
    unittest.main(argv=["first-arg-is-ignored"], exit=False)
