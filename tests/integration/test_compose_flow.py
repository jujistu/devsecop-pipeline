import os
import time
from pathlib import Path

import httpx


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3000")
PROCESSOR_URL = os.getenv("PDF_PROCESSOR_URL", "http://localhost:8000")
SAMPLE_PDF = REPO_ROOT / "quotiiPdfProcessor" / "tests" / "fixtures" / "sample.pdf"
OBJECT_STORE_ROOT = REPO_ROOT / ".ci" / "object-store"


def graphql(query: str, variables: dict | None = None, token: str | None = None):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    response = httpx.post(
        f"{BACKEND_URL}/",
        json={"query": query, "variables": variables or {}},
        headers=headers,
        timeout=30.0,
    )
    response.raise_for_status()
    return response.json()


def test_compose_stack_health():
    backend = httpx.get(f"{BACKEND_URL}/health", timeout=10.0)
    processor = httpx.get(f"{PROCESSOR_URL}/health", timeout=10.0)

    assert backend.status_code == 200
    assert backend.json() == {"status": "ok"}
    assert processor.status_code == 200
    assert processor.json() == {"status": "ok"}


def test_backend_to_processor_worker_flow():
    guest_id = f"ci-guest-{int(time.time())}"
    job_id = f"ci-job-{int(time.time())}"

    guest = graphql(
        """
        mutation RegisterGuest($guestId: String!) {
          registerGuest(guestId: $guestId) {
            accessToken
            user { _id email isGuest }
          }
        }
        """,
        {"guestId": guest_id},
    )
    token = guest["data"]["registerGuest"]["accessToken"]
    user_id = guest["data"]["registerGuest"]["user"]["_id"]

    with SAMPLE_PDF.open("rb") as pdf_file:
        response = httpx.post(
            f"{BACKEND_URL}/index",
            headers={"Authorization": f"Bearer {token}"},
            data={"title": "CI Sample", "jobId": job_id},
            files={"file": ("sample.pdf", pdf_file, "application/pdf")},
            timeout=60.0,
        )

    assert response.status_code == 202
    assert response.json()["job_id"] == job_id
    assert response.json()["index_status"] == "queued"

    deadline = time.time() + 120
    last_status = None
    last_error = None
    while time.time() < deadline:
        payload = graphql(
            """
            query GetBookIndexStatuses($jobIds: [String!]!) {
              getBookIndexStatuses(jobIds: $jobIds) {
                jobId
                indexStatus
                indexError
                contextObjectKey
              }
            }
            """,
            {"jobIds": [job_id]},
            token=token,
        )
        statuses = payload["data"]["getBookIndexStatuses"]
        if statuses:
            last_status = statuses[0]["indexStatus"]
            last_error = statuses[0]["indexError"]
            if last_status in {"ready", "failed"}:
                break
        time.sleep(2)

    assert last_status == "ready", f"expected ready, got {last_status!r} ({last_error!r})"

    context_path = OBJECT_STORE_ROOT / "books" / user_id / job_id / "context.md"
    deadline = time.time() + 30
    while time.time() < deadline and not context_path.exists():
        time.sleep(1)

    assert context_path.exists(), f"missing object-store context at {context_path}"
    context = context_path.read_text(encoding="utf-8")
    assert "<!-- page:" in context
    assert len(context.strip()) > 0
