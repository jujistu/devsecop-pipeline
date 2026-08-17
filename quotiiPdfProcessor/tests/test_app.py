import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

# Add the parent directory to the sys.path to allow imports from the app module
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import app, is_safe_job_id


class TestSafeJobId(unittest.TestCase):
    def test_accepts_simple_ids(self):
        for ok in ['abc123', 'book-1_2.3', 'a.b-c_d']:
            self.assertTrue(is_safe_job_id(ok), ok)

    def test_rejects_traversal_and_unsafe_ids(self):
        for bad in [None, '', '..', '../x', 'a/b', 'a\\b', 'a..b', '.hidden', 'a b']:
            self.assertFalse(is_safe_job_id(bad), repr(bad))


class TestIndexPdf(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.files = {'file': ('book.pdf', b'%PDF-1.4 fake', 'application/pdf')}

    def test_index_pdf_rejects_bad_file_type(self):
        response = self.client.post('/index-pdf', files={'file': ('book.txt', b'hi', 'text/plain')},
                                    data={'userId': 'u1', 'title': 'T', 'jobId': 'j1'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('File type not allowed', response.json()['error'])

    def test_index_pdf_rejects_missing_fields(self):
        # FastAPI validates required Form fields before the handler runs → 422.
        response = self.client.post('/index-pdf', files=self.files,
                                    data={'userId': 'u1', 'title': 'T'})
        self.assertEqual(response.status_code, 422)

    def test_index_pdf_rejects_unsafe_job_id(self):
        response = self.client.post('/index-pdf', files=self.files,
                                    data={'userId': 'u1', 'title': 'T', 'jobId': '../escape'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('Invalid jobId', response.json()['error'])

    def test_index_pdf_rejects_empty_file(self):
        response = self.client.post('/index-pdf', files={'file': ('book.pdf', b'', 'application/pdf')},
                                    data={'userId': 'u1', 'title': 'T', 'jobId': 'j1'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('Empty file', response.json()['error'])

    @patch('app.enqueue_cloud_index_job', new_callable=AsyncMock)
    @patch('app.get_object_store')
    @patch('app.get_mongo_db')
    def test_index_pdf_accepts_job_and_enqueues(self, mock_get_db, mock_get_store, mock_enqueue):
        mock_get_db.return_value = MagicMock()
        mock_get_store.return_value = MagicMock()
        mock_enqueue.return_value = None

        response = self.client.post('/index-pdf', files=self.files,
                                    data={'userId': 'u1', 'title': 'My Book', 'jobId': 'j1'})

        self.assertEqual(response.status_code, 202)
        body = response.json()
        self.assertEqual(body['job_id'], 'j1')
        self.assertEqual(body['index_status'], 'queued')
        mock_enqueue.assert_awaited_once_with(user_id='u1', job_id='j1')

    @patch('app.enqueue_cloud_index_job', new_callable=AsyncMock)
    @patch('app.get_object_store')
    @patch('app.get_mongo_db')
    def test_index_pdf_enqueue_failure_marks_book_failed(self, mock_get_db, mock_get_store, mock_enqueue):
        mock_db = MagicMock()
        mock_get_db.return_value = mock_db
        mock_get_store.return_value = MagicMock()
        mock_enqueue.side_effect = RuntimeError('redis down')

        response = self.client.post('/index-pdf', files=self.files,
                                    data={'userId': 'u1', 'title': 'My Book', 'jobId': 'j1'})

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()['index_status'], 'failed')
        mock_db.books.update_one.assert_called_once()
        update = mock_db.books.update_one.call_args[0][1]['$set']
        self.assertEqual(update['indexStatus'], 'failed')


class TestRetryIndex(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_retry_index_requires_job_id(self):
        response = self.client.post('/retry-index', json={})
        self.assertEqual(response.status_code, 400)
        self.assertIn('jobId is required', response.json()['error'])

    @patch('app.get_object_store')
    @patch('app.get_mongo_db')
    def test_retry_index_job_not_found(self, mock_get_db, mock_get_store):
        mock_db = MagicMock()
        mock_db.books.find_one.return_value = None
        mock_get_db.return_value = mock_db
        mock_get_store.return_value = MagicMock()

        response = self.client.post('/retry-index', json={'jobId': 'nope'})
        self.assertEqual(response.status_code, 404)
        self.assertIn('Indexing job not found', response.json()['error'])

    @patch('app.get_object_store')
    @patch('app.get_mongo_db')
    def test_retry_index_missing_source_pdf(self, mock_get_db, mock_get_store):
        mock_db = MagicMock()
        mock_db.books.find_one.return_value = {'jobId': 'j1', 'userId': 'u1', 'sourceObjectKey': 'books/u1/j1/source.pdf'}
        mock_get_db.return_value = mock_db
        mock_store = MagicMock()
        mock_store.exists.return_value = False
        mock_get_store.return_value = mock_store

        response = self.client.post('/retry-index', json={'jobId': 'j1'})
        self.assertEqual(response.status_code, 404)
        self.assertIn('Source PDF missing', response.json()['error'])

    @patch('app.enqueue_cloud_index_job', new_callable=AsyncMock)
    @patch('app.get_object_store')
    @patch('app.get_mongo_db')
    def test_retry_index_enqueues_and_marks_queued(self, mock_get_db, mock_get_store, mock_enqueue):
        mock_db = MagicMock()
        mock_db.books.find_one.return_value = {'jobId': 'j1', 'userId': 'u1', 'sourceObjectKey': 'books/u1/j1/source.pdf'}
        mock_get_db.return_value = mock_db
        mock_store = MagicMock()
        mock_store.exists.return_value = True
        mock_get_store.return_value = mock_store

        response = self.client.post('/retry-index', json={'jobId': 'j1'})

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json(), {'job_id': 'j1', 'index_status': 'queued'})
        mock_db.books.update_one.assert_called_once()
        set_fields = mock_db.books.update_one.call_args[0][1]['$set']
        self.assertEqual(set_fields['indexStatus'], 'queued')
        mock_enqueue.assert_awaited_once_with(user_id='u1', job_id='j1')


if __name__ == '__main__':
    unittest.main()
