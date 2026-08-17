"""Explicit Cloud indexing readiness statuses.

``ready`` means Book context exists for Book AI.
"""
from enum import Enum


class IndexStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"
