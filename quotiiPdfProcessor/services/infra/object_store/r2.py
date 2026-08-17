"""Cloudflare R2 adapter for the ObjectStore seam.

R2 exposes an S3-compatible API. Configuration is read from environment
variables (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
R2_REGION). No credentials are hardcoded here.
"""
import os
from typing import Optional

from services.infra.object_store.base import ObjectStore


class R2ObjectStore(ObjectStore):
    def __init__(
        self,
        *,
        access_key_id: Optional[str] = None,
        secret_access_key: Optional[str] = None,
        endpoint: Optional[str] = None,
        bucket: Optional[str] = None,
        region: Optional[str] = None,
    ) -> None:
        # Lazy import so FakeObjectStore tests never need boto3 installed.
        import boto3

        self._access_key_id = access_key_id or os.getenv("R2_ACCESS_KEY_ID")
        self._secret_access_key = secret_access_key or os.getenv("R2_SECRET_ACCESS_KEY")
        self._endpoint = endpoint or os.getenv("R2_ENDPOINT")
        self._bucket = bucket or os.getenv("R2_BUCKET")
        self._region = region or os.getenv("R2_REGION", "auto")

        missing = [
            name
            for name, value in (
                ("R2_ACCESS_KEY_ID", self._access_key_id),
                ("R2_SECRET_ACCESS_KEY", self._secret_access_key),
                ("R2_ENDPOINT", self._endpoint),
                ("R2_BUCKET", self._bucket),
            )
            if not value
        ]
        if missing:
            raise ValueError(
                "R2ObjectStore is missing required config: " + ", ".join(missing)
            )

        self._client = boto3.client(
            "s3",
            endpoint_url=self._endpoint,
            aws_access_key_id=self._access_key_id,
            aws_secret_access_key=self._secret_access_key,
            region_name=self._region,
        )

    def put(self, key: str, data: bytes, content_type: Optional[str] = None) -> None:
        kwargs = {"Bucket": self._bucket, "Key": key, "Body": data}
        if content_type:
            kwargs["ContentType"] = content_type
        self._client.put_object(**kwargs)

    def get(self, key: str) -> Optional[bytes]:
        from botocore.exceptions import ClientError

        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
            return response["Body"].read()
        except ClientError as exc:
            if self._is_not_found(exc):
                return None
            raise

    def delete(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError:
            return False

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError as exc:
            if self._is_not_found(exc):
                return False
            raise

    @staticmethod
    def _is_not_found(exc) -> bool:
        code = exc.response.get("Error", {}).get("Code", "")
        return code in ("404", "NotFound", "NoSuchKey", "NoSuchBucket")
