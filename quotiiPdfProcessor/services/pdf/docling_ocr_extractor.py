"""Docling Standard + RapidOCR extract adapter for scanned / mixed PDFs.

Lazy-imports Docling so Cloud indexing startup stays lean for text PDFs.
Does not leak Docling types outside this module — callers only see page-N.md
files under ``base_dir/<job_id>``, matching pdf-inspector output layout.

Hybrid path: pass ``pages`` (1-indexed) to OCR only those pages via
``page_range=(n, n)``, overwriting the matching inspector files.

When ``pages`` covers every inspector page on disk (typical scanned /
image_based), runs one full-document convert instead — per-page loops are
slower when almost every page needs OCR.
"""
from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path


def _page_files(out_dir: Path) -> list[int]:
    pages = []
    for path in out_dir.glob("page-*.md"):
        try:
            pages.append(int(path.stem.split("-", 1)[1]))
        except (IndexError, ValueError):
            continue
    return sorted(pages)


def _is_full_document_ocr(page_list: list[int], out_dir: Path) -> bool:
    """True when OCR pages are exactly 1..N and match every page file on disk."""
    wanted = sorted(set(page_list))
    if not wanted or wanted[0] != 1:
        return False
    if wanted != list(range(1, wanted[-1] + 1)):
        return False
    on_disk = _page_files(out_dir)
    return bool(on_disk) and wanted == on_disk


def _write_all_pages(doc, out_dir: Path) -> int:
    page_count = len(doc.pages) if getattr(doc, "pages", None) else 0
    if page_count <= 0:
        raise ValueError("Docling OCR produced no pages")
    for page_no in range(1, page_count + 1):
        markdown = doc.export_to_markdown(page_no=page_no) or ""
        (out_dir / f"page-{page_no}.md").write_text(markdown, encoding="utf-8")
    return page_count


def extract_pages_with_docling_ocr(
    pdf_path,
    job_id,
    base_dir="outputs",
    pages: Sequence[int] | None = None,
):
    """Run Docling Standard pipeline with RapidOCR (CPU) and write page Markdown.

    When ``pages`` is set:
      - if it covers the whole document on disk → one full ``convert``
      - else → per-page ``page_range=(n, n)`` (sparse mixed hybrid)

    When ``pages`` is None, converts the whole PDF.

    Returns the output directory (path-like) containing ``page-N.md`` files
    (1-indexed), compatible with ``_load_page_texts`` / ``store_book_context``.
    """
    # Lazy import: Docling + RapidOCR are heavy; keep /index-pdf text path lean.
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    out_dir = Path(base_dir) / str(job_id)
    out_dir.mkdir(parents=True, exist_ok=True)

    pipeline_options = PdfPipelineOptions(
        do_ocr=True,
        ocr_options=RapidOcrOptions(backend="onnxruntime"),
        # Book context is page text only; skip the slow TableFormer stage.
        do_table_structure=False,
    )

    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )

    if pages is not None:
        page_list = [int(p) for p in pages]
        if not page_list:
            raise ValueError("Docling OCR pages list is empty")

        if _is_full_document_ocr(page_list, out_dir):
            # scanned / image_based: one pipeline pass beats Nx page_range calls.
            result = converter.convert(str(pdf_path))
            _write_all_pages(result.document, out_dir)
            return out_dir

        for page_no in page_list:
            result = converter.convert(str(pdf_path), page_range=(page_no, page_no))
            markdown = result.document.export_to_markdown(page_no=page_no) or ""
            (out_dir / f"page-{page_no}.md").write_text(markdown, encoding="utf-8")
        return out_dir

    result = converter.convert(str(pdf_path))
    _write_all_pages(result.document, out_dir)
    return out_dir
