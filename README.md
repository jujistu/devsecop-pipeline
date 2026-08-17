# Quotii monorepo

This repository contains backend-only services:

- `quotiiBackend`: Node.js / TypeScript / Express / Apollo GraphQL / SSE
- `quotiiPdfProcessor`: Python / FastAPI / arq worker

There is **no browser frontend in this repository as of August 17, 2026**, so browser automation is intentionally not part of the required CI path here.

## Local test commands

```bash
# Node
cd quotiiBackend
yarn install --frozen-lockfile
yarn typecheck
yarn test
yarn test:coverage

# Python
cd ../quotiiPdfProcessor
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
./scripts/run-tests.sh
```

## Local compose smoke and integration

```bash
cd /path/to/quoti
rm -rf .ci/object-store && mkdir -p .ci/object-store
docker compose -f docker-compose.ci.yml up --build -d
./scripts/wait-for-services.sh
./tests/smoke/api-smoke.sh
python3 -m pip install pytest httpx
pytest tests/integration -q
docker compose -f docker-compose.ci.yml down --volumes --remove-orphans
```

## CI summary

- Node HTTP/API tests use `node:test` plus `Supertest`
- Python API tests use `pytest`, `TestClient`, and `httpx`
- Compose smoke tests use `curl`
- Compose integration tests use live HTTP against disposable MongoDB/Redis/backend/processor/worker containers
- DAST uses OWASP ZAP against the disposable stack
- Performance testing uses a separate scheduled/manual `k6` workflow

More detail lives in [docs/devsecops-ci.md](/Users/jujitsu/Documents/quoti/docs/devsecops-ci.md).
