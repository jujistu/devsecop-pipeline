import os
import shutil
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.pdf.pdf_inspector_extractor import extract_pages_with_inspector


class TestPdfInspectorExtractor(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)

    @patch('services.pdf.pdf_inspector_extractor.pdf_inspector')
    def test_writes_one_markdown_file_per_page(self, mock_pi):
        mock_pi.process_pdf.return_value = MagicMock(
            pdf_type='text_based', page_count=2, markdown='page one markdown',
            pages_needing_ocr=[])
        mock_pi.extract_pages_markdown.side_effect = AttributeError("no per-page")
        out_dir = extract_pages_with_inspector('fake.pdf', 'job-1', base_dir=self.tmp)
        files = sorted(os.listdir(out_dir))
        self.assertEqual(files, ['page-1.md', 'page-2.md'])
        with open(os.path.join(out_dir, 'page-1.md')) as fh:
            self.assertIn('page one markdown', fh.read())

    @patch('services.pdf.pdf_inspector_extractor.pdf_inspector')
    def test_returns_ocr_page_list_for_scanned(self, mock_pi):
        mock_pi.process_pdf.return_value = MagicMock(
            pdf_type='scanned', page_count=1, markdown=None, pages_needing_ocr=[1])
        mock_pi.extract_pages_markdown.side_effect = AttributeError("no per-page")
        pdf_type, pages_needing_ocr = extract_pages_with_inspector(
            'fake.pdf', 'job-2', base_dir=self.tmp
        )
        self.assertEqual(pdf_type, 'scanned')
        self.assertEqual(pages_needing_ocr, [1])

    @patch('services.pdf.pdf_inspector_extractor.pdf_inspector')
    def test_mixed_uses_per_page_needs_ocr_flags(self, mock_pi):
        mock_pi.process_pdf.return_value = MagicMock(
            pdf_type='mixed', page_count=3, markdown=None, pages_needing_ocr=[1]
        )
        p1 = MagicMock(page=0, markdown='', needs_ocr=True)
        p2 = MagicMock(page=1, markdown='digital text', needs_ocr=False)
        p3 = MagicMock(page=2, markdown='', needs_ocr=True)
        mock_pi.extract_pages_markdown.return_value = MagicMock(
            pages=[p1, p2, p3], pages_needing_ocr=[1, 3]
        )
        result = extract_pages_with_inspector('mixed.pdf', 'job-3', base_dir=self.tmp)
        self.assertEqual(result.pdf_type, 'mixed')
        self.assertEqual(result.pages_needing_ocr, [1, 3])
        with open(os.path.join(result, 'page-2.md')) as fh:
            self.assertEqual(fh.read(), 'digital text')


if __name__ == '__main__':
    unittest.main()
