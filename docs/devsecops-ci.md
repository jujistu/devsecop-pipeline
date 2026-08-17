# Quotii DevSecOps CI

This repository contains two backend services and no browser frontend:

- `quotiiBackend`: Node.js / TypeScript / Express / Apollo GraphQL / SSE
- `quotiiPdfProcessor`: Python / FastAPI / arq worker

Browser automation is intentionally **not** part of the required pull-request pipeline because there is no browser-accessible frontend in this repository on **August 17, 2026**. If a web frontend is added later, add a separate Playwright or Selenium smoke layer for that repository or monorepo package.

## Implemented CI architecture

```text
Pull Request / Push
        |
        +-----------------------------+
        |                             |
        v                             v
 Node unit + API tests          Python unit + API tests
 node:test + Supertest          pytest + TestClient/httpx
        |                             |
        +-------------+---------------+
                      |
                      v
                   Coverage
                      |
                      v
              Secret scan / SAST / SCA
      Bandit, SonarQube, Dependency-Check,
      pip-audit, yarn audit, Trivy fs
                      |
                      v
                 Docker build
                      |
                      v
              Trivy image scan + SBOM
                      |
                      v
               Docker Compose CI
      MongoDB + Redis + backend + processor + worker
                      |
        +-------------+-------------+
        |                           |
        v                           v
    API smoke                   Integration
      curl                     pytest + httpx
        |                           |
        +-------------+-------------+
                      |
                      v
                 OWASP ZAP
      OpenAPI scan for FastAPI + baseline scan
      for the Node backend / GraphQL surface
                      |
                      v
                   Publish
              immutable Git SHA tags
```

## Test layers

### Node API

- Keeps the existing `node:test` + `ts-node` foundation.
- Adds `Supertest` HTTP coverage for:
  - `GET /health`
  - `POST /index`
  - `POST /explain`
  - `POST /ask`
  - `POST /summary`
  - GraphQL endpoint auth and payloads
- Coverage remains on `c8`.

### Python API

- Uses `pytest`, FastAPI `TestClient`, and `pytest-cov`.
- Covers:
  - `GET /health`
  - `POST /index-pdf`
  - `POST /retry-index`
  - multipart uploads
  - validation failures
  - invalid `jobId`
  - missing files
  - Redis enqueue failures
  - Mongo/object-store failure paths

### Smoke tests

- `tests/smoke/api-smoke.sh`
- Uses `curl --fail` only.
- Verifies the running compose containers answer on:
  - `http://localhost:3000/health`
  - `http://localhost:8000/health`

### Integration tests

- `tests/integration/test_compose_flow.py`
- Starts the real compose stack:
  - MongoDB
  - Redis
  - `quotiiBackend`
  - `quotiiPdfProcessor`
  - `quotiiPdfProcessor` worker
- Exercises the live flow:
  - GraphQL `registerGuest`
  - backend `POST /index`
  - processor `/index-pdf`
  - Redis enqueue
  - worker completion
  - Mongo status updates
  - shared fake object-store artifact creation

### DAST

- OWASP ZAP runs against the disposable compose stack only.
- FastAPI is scanned from `http://127.0.0.1:8000/openapi.json`.
- The Node service is scanned separately via ZAP baseline on `http://127.0.0.1:3000/`.
- The repository contains `quotiiBackend/schema.graphql`; today the workflow uses the live backend surface for the Node DAST step and leaves direct GraphQL schema import as a follow-up hardening item.

### Performance

- `tests/performance/api-load.js`
- Runs in `.github/workflows/k6-performance.yml`
- Triggered only by schedule or manual dispatch, not every pull request.
- Measures:
  - backend and processor health latency
  - guest registration latency
  - `/index` submission latency and error rate

## Shared fake object store for CI

The previous in-memory fake object store was process-local and could not support multi-container integration tests. CI now mounts `./.ci/object-store` into:

- `backend`
- `pdf-processor`
- `pdf-worker`

Both language runtimes use `FAKE_OBJECT_STORE_DIR=/object-store` so the worker can write Book context and the integration tests can verify the artifact without any production R2 dependency.

## Local execution

Run everything locally from the repository root:

```bash
# Node tests
cd quotiiBackend
yarn install --frozen-lockfile
yarn typecheck
yarn test
yarn test:coverage

# Python tests
cd ../quotiiPdfProcessor
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
./scripts/run-tests.sh

# Compose smoke + integration
cd ..
rm -rf .ci/object-store && mkdir -p .ci/object-store
docker compose -f docker-compose.ci.yml up --build -d
./scripts/wait-for-services.sh
./tests/smoke/api-smoke.sh
python3 -m pip install pytest httpx
pytest tests/integration -q
docker compose -f docker-compose.ci.yml down --volumes --remove-orphans

# ZAP
docker compose -f docker-compose.ci.yml up --build -d
docker run --rm --network host -v "$PWD:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
  zap-api-scan.py -t http://127.0.0.1:8000/openapi.json -f openapi -r zap-fastapi-report.html -J zap-fastapi-report.json
docker run --rm --network host -v "$PWD:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://127.0.0.1:3000/ -r zap-backend-report.html -J zap-backend-report.json
docker compose -f docker-compose.ci.yml down --volumes --remove-orphans

# k6
docker compose -f docker-compose.ci.yml up --build -d
docker run --rm --network host -v "$PWD:/work" grafana/k6:0.50.0 run /work/tests/performance/api-load.js
docker compose -f docker-compose.ci.yml down --volumes --remove-orphans
```

## Remaining hardening items

- Pin GitHub Actions to full commit SHAs.
- Pin base images by digest instead of mutable tags.
- Add direct GraphQL-schema-driven ZAP import once the preferred ZAP invocation is finalized for this backend.
- Investigate any historical Firebase key material and rotate/revoke anything that was ever committed before enabling stricter secret-scanning enforcement.
