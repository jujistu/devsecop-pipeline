"""Explicit Cloud indexing readiness statuses.

``ready`` means Book context exists for Book AI.
"""
from enum import StrEnum


class IndexStatus(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"
