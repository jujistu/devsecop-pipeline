# quotiiPdfProcessor

Python FastAPI service that builds **Book context** for Nuggets. It extracts page-aware text from a PDF, stores the blob in object storage, and writes Cloud indexing status to Mongo.

The Node [backend](../quotiiBackend/README.md) kicks off jobs (`POST /index` → `/index-pdf`) and serves Book AI. This process does not call the LLM.

## Role

Eager **Cloud indexing** starts after **Add to library**. The API accepts the PDF, stores `source.pdf`, marks the book `queued`, and enqueues an arq job. A **separate worker** extracts text (pdf-inspector for digital pages, Docling OCR for scanned/mixed), writes `books/{userId}/{jobId}/context.md`, and sets `indexStatus` to `ready` or `failed`.

The **Reader** does not wait on this path. Book AI on the backend waits until status is `ready` and the blob loads.

Glossary: [`quotii/CONTEXT.md`](../quotii/CONTEXT.md). Decisions: [`docs/adr/`](../docs/adr/) (0001, 0004, 0010, 0014, 0018).

This service is Cloud-indexing only. Quote extraction and `POST /process-pdf` were removed.

## Prerequisites

- Python 3.11+
- Redis (arq queue; default `redis://localhost:6379`)
- MongoDB (same database as the backend)
- Cloudflare R2 credentials for durable blobs (or omit them to use the in-memory fake)

## Setup

```bash
cd quotiiPdfProcessor
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env`. Mongo URI here is `MONGO_URI`. The backend uses `MONGO_DB_CONNECTION_STRING`. Same database, different names.

`APP_ENV=production` deletes local `outputs/<job_id>` after a job. Development keeps those files.

If R2 keys are missing, or `OBJECT_STORE=fake`, blobs stay in memory. Restarts and the backend then cannot load Book context.

## Run

Two processes. Both load the same `.env`.

```bash
# API — port 8000
python run.py

# Worker — Docling/OCR lives here, not in the API process
python worker.py
```

`run.py` is uvicorn with reload (`app:app`, `0.0.0.0:8000`).

Set backend `PDF_PROCESSOR_ENDPOINT=http://localhost:8000`.

If Redis is down, `/index-pdf` and `/retry-index` mark the book `failed` (`queue enqueue failed`) instead of leaving it stuck in `queued`.

## HTTP

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/index-pdf` | Multipart: `file`, `userId`, `title`, `jobId`. Stores the source PDF, enqueues `cloud_index_job`, returns `202` with `job_id` + `index_status`. |
| `POST` | `/retry-index` | JSON `{ "jobId": "…" }`. Re-drives a failed job from the stored source PDF. `404` if the job or source blob is missing. |

`jobId` must match `^[A-Za-z0-9._-]+$` (no `..`, `/`, or leading `.`).

Index status: `queued` → `processing` → `ready` | `failed`. `ready` means Book context exists for Book AI.

Worker defaults: 2 concurrent jobs, 30-minute timeout (large scanned PDFs), no kept arq result payload. Mongo + R2 are the source of truth; retry re-reads `source.pdf`.

## Layout

```
app.py                         FastAPI routes
run.py                         local uvicorn
worker.py                      arq worker (cloud_index_job)
services/indexing/             enqueue + extract + status
services/pdf/                  pdf-inspector + Docling OCR
services/infra/                Mongo, env, ObjectStore (R2 / fake)
services/queue.py              Redis pool + enqueue
services/domain/indexStatus.py queued | processing | ready | failed
tests/
```

## Tests

```bash
PYTHONPATH=. python -m pytest tests/ -q
```

Coverage:

```bash
./scripts/run-tests.sh
```

Tests use `pytest`, FastAPI `TestClient`, and `pytest-cov`. They fake Docling,
Mongo, Redis, and object storage, so they do not need a live worker or any
production infrastructure.
