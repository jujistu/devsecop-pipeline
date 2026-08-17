#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

services=(
  "http://localhost:8000/health|PDF Processor"
  "http://localhost:3000/health|Node backend"
)

for entry in "${services[@]}"; do
  url="${entry%%|*}"
  name="${entry##*|}"
  echo "Waiting for ${name} at ${url}..."
  timeout 180 bash -c "until curl --fail --silent '${url}' > /dev/null; do sleep 3; done"
  echo "${name} is healthy."
done

echo "All services are ready."
