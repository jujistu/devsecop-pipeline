"""Fake ObjectStore for tests/local/dev fallback.

Defaults to in-memory behavior for unit tests. When ``FAKE_OBJECT_STORE_DIR``
is set, blobs are persisted under that directory so multiple containers can
share the same fake object store in Docker Compose CI.
"""
import os
from pathlib import Path
from typing import Dict, List, Optional

from services.infra.object_store.base import ObjectStore


class FakeObjectStore(ObjectStore):
    def __init__(self) -> None:
        self._blobs: Dict[str, bytes] = {}
        base_dir = os.getenv("FAKE_OBJECT_STORE_DIR", "").strip()
        self._base_dir = Path(base_dir) if base_dir else None
        if self._base_dir:
            self._base_dir.mkdir(parents=True, exist_ok=True)

    def _path_for(self, key: str) -> Optional[Path]:
        if not self._base_dir:
            return None
        return self._base_dir.joinpath(*[part for part in key.split("/") if part])

    def put(self, key: str, data: bytes, content_type: Optional[str] = None) -> None:
        blob = bytes(data)
        path = self._path_for(key)
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(blob)
            return
        self._blobs[key] = blob

    def get(self, key: str) -> Optional[bytes]:
        path = self._path_for(key)
        if path:
            return path.read_bytes() if path.exists() else None
        return self._blobs.get(key)

    def delete(self, key: str) -> bool:
        path = self._path_for(key)
        if path:
            if not path.exists():
                return False
            path.unlink()
            return True
        return self._blobs.pop(key, None) is not None

    def exists(self, key: str) -> bool:
        path = self._path_for(key)
        if path:
            return path.exists()
        return key in self._blobs

    def keys(self, prefix: str = "") -> List[str]:
        if self._base_dir:
            keys: List[str] = []
            for path in self._base_dir.rglob("*"):
                if path.is_file():
                    key = path.relative_to(self._base_dir).as_posix()
                    if key.startswith(prefix):
                        keys.append(key)
            return keys
        return [key for key in self._blobs if key.startswith(prefix)]
