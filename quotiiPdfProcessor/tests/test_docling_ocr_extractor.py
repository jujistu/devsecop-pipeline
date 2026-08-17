"""Unit tests for the Docling OCR extract adapter (Docling fully faked via sys.modules)."""
import os
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _install_fake_docling(*, page_count: int, markdown_by_page=None):
    """Inject a minimal docling package tree so the adapter can lazy-import."""
    markdown_by_page = markdown_by_page or {}

    docling = types.ModuleType("docling")
    datamodel = types.ModuleType("docling.datamodel")
    base_models = types.ModuleType("docling.datamodel.base_models")
    pipeline_options = types.ModuleType("docling.datamodel.pipeline_options")
    document_converter = types.ModuleType("docling.document_converter")

    class InputFormat:
        PDF = "pdf"

    class RapidOcrOptions:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.force_full_page_ocr = False

    class PdfPipelineOptions:
        def __init__(self, **kwargs):
            self.do_ocr = kwargs.get("do_ocr")
            self.ocr_options = kwargs.get("ocr_options")

    class PdfFormatOption:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    convert_calls = []

    def _make_doc(for_pages):
        doc = MagicMock()
        doc.pages = {i: object() for i in for_pages}
        doc.export_to_markdown.side_effect = lambda page_no=None: markdown_by_page.get(
            page_no, f"ocr text {page_no}"
        )
        return doc

    class DocumentConverter:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def convert(self, source, page_range=None):
            convert_calls.append({"source": source, "page_range": page_range})
            if page_range is not None:
                start, end = page_range
                doc = _make_doc(range(start, end + 1))
            else:
                doc = _make_doc(range(1, page_count + 1))
            return MagicMock(document=doc)

    base_models.InputFormat = InputFormat
    pipeline_options.PdfPipelineOptions = PdfPipelineOptions
    pipeline_options.RapidOcrOptions = RapidOcrOptions
    document_converter.DocumentConverter = DocumentConverter
    document_converter.PdfFormatOption = PdfFormatOption

    modules = {
        "docling": docling,
        "docling.datamodel": datamodel,
        "docling.datamodel.base_models": base_models,
        "docling.datamodel.pipeline_options": pipeline_options,
        "docling.document_converter": document_converter,
    }
    return modules, convert_calls


class TestDoclingOcrExtractor(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self._saved_modules = {}

    def tearDown(self):
        for name, previous in self._saved_modules.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous

    def _activate_fake_docling(self, *, page_count: int, markdown_by_page=None):
        modules, convert_calls = _install_fake_docling(
            page_count=page_count, markdown_by_page=markdown_by_page
        )
        for name, module in modules.items():
            self._saved_modules[name] = sys.modules.get(name)
            sys.modules[name] = module
        return convert_calls

    def test_writes_page_markdown_files(self):
        convert_calls = self._activate_fake_docling(page_count=2)
        from services.pdf.doclingOcrExtractor import extract_pages_with_docling_ocr

        out_dir = extract_pages_with_docling_ocr(
            "scan.pdf", "job-ocr-1", base_dir=self.tmp
        )

        self.assertEqual(Path(out_dir), Path(self.tmp) / "job-ocr-1")
        self.assertEqual(
            sorted(os.listdir(out_dir)),
            ["page-1.md", "page-2.md"],
        )
        self.assertEqual(
            (Path(out_dir) / "page-1.md").read_text(encoding="utf-8"),
            "ocr text 1",
        )
        self.assertEqual(
            (Path(out_dir) / "page-2.md").read_text(encoding="utf-8"),
            "ocr text 2",
        )
        self.assertEqual(len(convert_calls), 1)
        self.assertIsNone(convert_calls[0]["page_range"])

    def test_pages_arg_converts_per_page_range(self):
        convert_calls = self._activate_fake_docling(page_count=10)
        from services.pdf.doclingOcrExtractor import extract_pages_with_docling_ocr

        out_dir = Path(self.tmp) / "job-hybrid"
        out_dir.mkdir()
        (out_dir / "page-1.md").write_text("keep me", encoding="utf-8")
        (out_dir / "page-2.md").write_text("", encoding="utf-8")
        (out_dir / "page-3.md").write_text("also keep", encoding="utf-8")

        extract_pages_with_docling_ocr(
            "mixed.pdf", "job-hybrid", base_dir=self.tmp, pages=[2]
        )

        self.assertEqual(
            (out_dir / "page-1.md").read_text(encoding="utf-8"),
            "keep me",
        )
        self.assertEqual(
            (out_dir / "page-2.md").read_text(encoding="utf-8"),
            "ocr text 2",
        )
        self.assertEqual(
            (out_dir / "page-3.md").read_text(encoding="utf-8"),
            "also keep",
        )
        self.assertEqual(convert_calls, [{"source": "mixed.pdf", "page_range": (2, 2)}])

    def test_full_document_ocr_pages_uses_one_convert(self):
        """scanned/image_based: pages == every file on disk → full convert."""
        convert_calls = self._activate_fake_docling(page_count=3)
        from services.pdf.doclingOcrExtractor import extract_pages_with_docling_ocr

        out_dir = Path(self.tmp) / "job-scan"
        out_dir.mkdir()
        for i in (1, 2, 3):
            (out_dir / f"page-{i}.md").write_text("", encoding="utf-8")

        extract_pages_with_docling_ocr(
            "scan.pdf", "job-scan", base_dir=self.tmp, pages=[1, 2, 3]
        )

        self.assertEqual(convert_calls, [{"source": "scan.pdf", "page_range": None}])
        self.assertEqual(
            (out_dir / "page-2.md").read_text(encoding="utf-8"),
            "ocr text 2",
        )

    def test_prefix_ocr_pages_still_per_page(self):
        """OCR pages 1..K on a longer book must not trigger full convert."""
        convert_calls = self._activate_fake_docling(page_count=10)
        from services.pdf.doclingOcrExtractor import extract_pages_with_docling_ocr

        out_dir = Path(self.tmp) / "job-mixed-prefix"
        out_dir.mkdir()
        for i in range(1, 6):
            (out_dir / f"page-{i}.md").write_text(f"text {i}", encoding="utf-8")

        extract_pages_with_docling_ocr(
            "mixed.pdf",
            "job-mixed-prefix",
            base_dir=self.tmp,
            pages=[1, 2, 3],
        )

        self.assertEqual(len(convert_calls), 3)
        self.assertEqual(
            [c["page_range"] for c in convert_calls],
            [(1, 1), (2, 2), (3, 3)],
        )
        self.assertEqual(
            (out_dir / "page-4.md").read_text(encoding="utf-8"),
            "text 4",
        )

    def test_empty_pages_raises(self):
        self._activate_fake_docling(page_count=0)
        from services.pdf.doclingOcrExtractor import extract_pages_with_docling_ocr

        with self.assertRaises(ValueError):
            extract_pages_with_docling_ocr("empty.pdf", "job-empty", base_dir=self.tmp)

    def test_empty_pages_list_raises(self):
        self._activate_fake_docling(page_count=2)
        from services.pdf.doclingOcrExtractor import extract_pages_with_docling_ocr

        with self.assertRaises(ValueError):
            extract_pages_with_docling_ocr(
                "mixed.pdf", "job-empty-list", base_dir=self.tmp, pages=[]
            )


if __name__ == "__main__":
    unittest.main(argv=["first-arg-is-ignored"], exit=False)
