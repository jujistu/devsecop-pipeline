#!/usr/bin/env bash
set -euo pipefail

# Resolve repo root from this script's location: scripts/ is one level below
# quotiiPdfProcessor/, which is one level below the repo root.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/quotiiPdfProcessor"

PYTHONPATH=. python -m pytest tests/ -q \
  --cov=. \
  --cov-report=xml \
  --cov-report=term
