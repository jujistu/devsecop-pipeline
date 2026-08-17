from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import JSONResponse
import re

from services.infra.db import get_mongo_db
from services.infra.object_store import get_object_store
from services.indexing.cloud_indexing import enqueue_cloud_index, prepare_retry_cloud_index
from services.queue import enqueue_cloud_index_job

app = FastAPI(title="quotiiPdfProcessor")


@app.get('/health')
async def health():
    return {'status': 'ok'}


ALLOWED_EXTENSIONS = {'pdf'}
SAFE_ID_PATTERN = re.compile(r'^[A-Za-z0-9._-]+$')


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def is_safe_job_id(job_id):
    """Return True only for simple, non-traversable job identifiers.

    Used before any use of the jobId (Issue 11).
    """
    if not job_id:
        return False
    job_id = str(job_id)
    if '..' in job_id or '/' in job_id or '\\' in job_id:
        return False
    return bool(SAFE_ID_PATTERN.match(job_id)) and not job_id.startswith('.')


@app.post('/index-pdf')
async def indexPdf(
    file: UploadFile = File(...),
    userId: str = Form(...),
    title: str = Form(...),
    jobId: str = Form(...),
):
    """Eager Cloud indexing for text PDFs. Returns 202 while Reader stays usable."""
    print('cloud indexing commencing')

    if not allowed_file(file.filename or 'document.pdf'):
        return JSONResponse(content={"error": "File type not allowed"}, status_code=400)

    if not jobId or not userId or not title:
        return JSONResponse(content={"error": "Missing required fields"}, status_code=400)

    if not is_safe_job_id(jobId):
        return JSONResponse(content={"error": "Invalid jobId"}, status_code=400)

    try:
        pdf_bytes = await file.read()
        if not pdf_bytes:
            return JSONResponse(content={"error": "Empty file"}, status_code=400)

        db = get_mongo_db()
        store = get_object_store()
        snap = enqueue_cloud_index(
            db=db,
            object_store=store,
            user_id=userId,
            job_id=jobId,
            title=title,
            pdf_bytes=pdf_bytes,
        )
        try:
            await enqueue_cloud_index_job(user_id=userId, job_id=jobId)
        except Exception:
            # Never leave a book stuck in queued when Redis is unreachable.
            db.books.update_one(
                {'jobId': str(jobId)},
                {'$set': {'indexStatus': 'failed', 'indexError': 'queue enqueue failed'}},
            )
            raise
        return JSONResponse(
            content={
                "job_id": snap["job_id"],
                "index_status": snap["index_status"],
            },
            status_code=202,
        )
    except Exception as e:
        print('error enqueueing cloud index ---> ', e)
        return JSONResponse(
            content={"job_id": jobId, "index_status": "failed", "error": str(e)},
            status_code=500,
        )


@app.post('/retry-index')
async def retryIndex(payload: dict):
    """Re-enter Cloud indexing from a failed job using the stored source PDF."""
    job_id = payload.get('jobId') or payload.get('job_id')
    if not job_id:
        return JSONResponse(content={"error": "jobId is required"}, status_code=400)

    if not is_safe_job_id(job_id):
        return JSONResponse(content={"error": "Invalid jobId"}, status_code=400)

    try:
        db = get_mongo_db()
        store = get_object_store()
        try:
            snap = prepare_retry_cloud_index(
                db=db, object_store=store, job_id=str(job_id)
            )
        except ValueError:
            return JSONResponse(content={"error": "Indexing job not found"}, status_code=404)
        except FileNotFoundError:
            return JSONResponse(
                content={"error": "Source PDF missing; re-upload required"},
                status_code=404,
            )

        # Marked queued above so GraphQL observers see the retry start;
        # extraction runs in the arq worker (does not block the client).
        try:
            await enqueue_cloud_index_job(
                user_id=snap["user_id"], job_id=snap["job_id"]
            )
        except Exception:
            db.books.update_one(
                {"jobId": snap["job_id"]},
                {"$set": {"indexStatus": "failed", "indexError": "queue enqueue failed"}},
            )
            raise
        return JSONResponse(
            content={"job_id": snap["job_id"], "index_status": "queued"},
            status_code=202,
        )
    except Exception as e:
        print('error retrying cloud index ---> ', e)
        return JSONResponse(content={"error": str(e)}, status_code=500)
