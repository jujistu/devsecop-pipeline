"""arq background worker: consumes ``cloud_index_job`` (Docling/OCR heavy).

Runs as a separate process so PDF processing never shares the API process:

    python worker.py

Requires Redis (REDIS_URL, default redis://localhost:6379) plus the same
MONGO_URI / R2_* env vars as the API.
"""
import asyncio
import logging.config

from arq import Worker
from arq.logs import default_log_config

from services.indexing.cloud_indexing import cloud_index_job
from services.queue import redis_settings


async def main() -> None:
    logging.config.dictConfig(default_log_config(verbose=False))
    worker = Worker(
        functions=[cloud_index_job],
        redis_settings=redis_settings(),
        # Docling OCR is CPU-bound: 2 concurrent jobs per worker; scale workers.
        max_jobs=2,
        # A 638-page scanned book can exceed 10 minutes; 30-minute ceiling.
        job_timeout=1800,
        # Drop finished job payloads immediately (Mongo/R2 are the source of truth).
        keep_result=0,
    )
    await worker.async_run()


if __name__ == "__main__":
    asyncio.run(main())
