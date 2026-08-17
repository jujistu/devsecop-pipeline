"""arq queue wiring: lazy Redis pool + job enqueue helpers.

The queue is treated as disposable — Mongo + R2 are the source of truth for
recovery (``/retry-index`` re-drives a job from the stored source PDF).
"""
import os
from typing import Optional

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

_pool: Optional[ArqRedis] = None


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(os.getenv("REDIS_URL", "redis://localhost:6379"))


async def get_pool() -> ArqRedis:
    global _pool
    if _pool is None:
        # Lazy singleton created on first enqueue and reused for the process
        # lifetime (ponytail: no lifespan ceremony; a dropped pool at exit is fine).
        _pool = await create_pool(redis_settings())
    return _pool


async def enqueue_cloud_index_job(*, user_id: str, job_id: str) -> None:
    """Enqueue a Cloud indexing job for the arq worker (``cloud_index_job``)."""
    pool = await get_pool()
    await pool.enqueue_job("cloud_index_job", user_id=user_id, job_id=job_id)
