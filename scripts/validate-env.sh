#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail=0

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    fail=1
  fi
}

case "${SERVICE:-backend}" in
  backend)
    require_var MONGO_DB_CONNECTION_STRING
    require_var JWT_ACCESS_SECRET
    require_var JWT_REFRESH_SECRET
    require_var PDF_PROCESSOR_ENDPOINT
    ;;
  pdf-processor|pdf-worker)
    require_var MONGO_URI
    require_var REDIS_URL
    ;;
  *)
    echo "Unknown SERVICE=${SERVICE}" >&2
    exit 1
    ;;
esac

if [[ "${fail}" -ne 0 ]]; then
  exit 1
fi

echo "Environment validation passed for SERVICE=${SERVICE}."
