"""PDF extraction via Firecrawl pdf-inspector (Rust, fast, no OCR for text PDFs)."""
import os
import re
from pathlib import Path

import pdf_inspector

# pdf-inspector separates pages in whole-document markdown with form feeds or
# markdown horizontal rules flanked by blank lines.
_PAGE_BREAK_RE = re.compile(r"\f|(?:\n{2,}\s*-{3,}\s*\n{2,})")

# pdf_types that indicate a downstream OCR pass is required.
_OCR_TYPES = ("scanned", "image_based", "mixed")


def _split_markdown_pages(markdown):
    """Split a whole-document markdown string into per-page chunks."""
    return [chunk.strip() for chunk in re.split(_PAGE_BREAK_RE, markdown) if chunk.strip()]


class _ExtractionResult:
    """Output of an inspector extraction.

    The object is the output directory (path-like, so callers can inspect the
    written per-page files) and also unpacks as ``(pdf_type,
    pages_needing_ocr)`` for callers that only want the classification.
    ``pages_needing_ocr`` is a 1-indexed list of page numbers (empty when none).
    """

    __slots__ = ("out_dir", "pages_needing_ocr", "pdf_type")

    def __init__(self, out_dir, pdf_type, pages_needing_ocr):
        self.out_dir = out_dir
        self.pdf_type = pdf_type
        self.pages_needing_ocr = list(pages_needing_ocr or [])

    def __fspath__(self):
        return os.fspath(self.out_dir)

    def __str__(self):
        return str(self.out_dir)

    def __repr__(self):
        return (
            f"_ExtractionResult(out_dir={str(self.out_dir)!r}, "
            f"pdf_type={self.pdf_type!r}, "
            f"pages_needing_ocr={self.pages_needing_ocr!r})"
        )

    def __iter__(self):
        return iter((self.pdf_type, self.pages_needing_ocr))


def extract_pages_with_inspector(pdf_path, job_id, base_dir="outputs"):
    """Classify and extract a PDF into per-page Markdown files.

    Writes ``page-N.md`` files under ``base_dir/<job_id>``. Uses
    pdf-inspector's per-page markdown extraction when available, falling back
    to splitting the whole-document markdown on page separators.

    Returns an :class:`_ExtractionResult` that is the output directory
    (path-like) and also unpacks as ``(pdf_type, pages_needing_ocr)``; the
    second element is a 1-indexed list of pages that need Docling OCR
    (empty for text-only PDFs).
    """
    result = pdf_inspector.process_pdf(str(pdf_path))
    out_dir = Path(base_dir) / str(job_id)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Prefer per-page markdown from a single parse.
    pages = []
    pages_needing_ocr = []
    try:
        page_results = pdf_inspector.extract_pages_markdown(str(pdf_path))
        # PageMarkdown.page is 0-indexed; filenames are 1-indexed.
        pages = [
            (page_result.page + 1, page_result.markdown or "")
            for page_result in (page_results.pages or [])
        ]
        # Prefer explicit per-page flags; fall back to result list (1-indexed).
        pages_needing_ocr = [
            page_result.page + 1
            for page_result in (page_results.pages or [])
            if getattr(page_result, "needs_ocr", False)
        ]
        if not pages_needing_ocr:
            pages_needing_ocr = list(getattr(page_results, "pages_needing_ocr", None) or [])
    except (AttributeError, TypeError, ValueError):
        pages = []

    # Fallback: split the single-document markdown on page separators and
    # pad/truncate to the reported page count.
    if not pages:
        page_count = int(getattr(result, "page_count", 1) or 1)
        chunks = _split_markdown_pages(result.markdown or "")
        pages = list(enumerate(chunks, start=1))
        pages.extend((i, "") for i in range(len(pages) + 1, page_count + 1))
        pages = pages[:page_count]
        pages_needing_ocr = list(getattr(result, "pages_needing_ocr", None) or [])

    for page_num, markdown in pages:
        (out_dir / f"page-{page_num}.md").write_text(markdown, encoding="utf-8")

    pdf_type = result.pdf_type
    # Scanned/image docs with no page list: OCR every page.
    if not pages_needing_ocr and pdf_type in _OCR_TYPES:
        pages_needing_ocr = [page_num for page_num, _ in pages]

    return _ExtractionResult(out_dir, pdf_type, pages_needing_ocr)
