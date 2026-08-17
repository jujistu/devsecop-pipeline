from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app import app


@pytest.fixture()
def client():
    return TestClient(app)


def test_health_returns_ok(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_index_pdf_requires_multipart_file(client):
    response = client.post(
        "/index-pdf",
        data={"userId": "u1", "title": "Book", "jobId": "job-1"},
    )

    assert response.status_code == 422


def test_retry_index_rejects_invalid_job_id(client):
    response = client.post("/retry-index", json={"jobId": "../bad"})

    assert response.status_code == 400
    assert response.json() == {"error": "Invalid jobId"}


def test_index_pdf_returns_500_when_enqueue_persistence_fails(client, monkeypatch):
    monkeypatch.setattr("app.get_mongo_db", lambda: MagicMock())
    monkeypatch.setattr("app.get_object_store", lambda: MagicMock())
    monkeypatch.setattr(
        "app.enqueue_cloud_index",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("mongo down")),
    )
    monkeypatch.setattr("app.enqueue_cloud_index_job", AsyncMock())

    response = client.post(
        "/index-pdf",
        files={"file": ("book.pdf", b"%PDF-1.4 fake", "application/pdf")},
        data={"userId": "u1", "title": "Book", "jobId": "job-1"},
    )

    assert response.status_code == 500
    assert response.json()["index_status"] == "failed"
    assert "mongo down" in response.json()["error"]


def test_retry_index_returns_500_when_store_lookup_fails(client, monkeypatch):
    mock_db = MagicMock()
    monkeypatch.setattr("app.get_mongo_db", lambda: mock_db)
    monkeypatch.setattr(
        "app.get_object_store",
        lambda: (_ for _ in ()).throw(RuntimeError("object store down")),
    )

    response = client.post("/retry-index", json={"jobId": "job-1"})

    assert response.status_code == 500
    assert "object store down" in response.json()["error"]
