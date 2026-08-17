#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/quotiiPdfProcessor"

PYTHONPATH=. python -m pytest tests/ -q \
  --cov=. \
  --cov-report=xml \
  --cov-report=term
