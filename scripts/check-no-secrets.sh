#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

patterns=(
  'AKIA[0-9A-Z]{16}'
  '-{5}BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-{5}'
  'firebase-adminsdk'
)

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --source . --redact --no-banner --exit-code 1
  echo "Gitleaks secret scan passed."
  exit 0
fi

echo "Gitleaks not installed; running lightweight pattern scan."

while IFS= read -r -d '' file; do
  case "$file" in
    *.png|*.jpg|*.jpeg|*.gif|*.pdf|*.tar|*.gz|*.zip|yarn.lock|package-lock.json)
      continue
      ;;
  esac
  for pattern in "${patterns[@]}"; do
    if grep -E -q -- "$pattern" "$file"; then
      echo "Potential secret pattern matched in ${file}" >&2
      exit 1
    fi
  done
done < <(find . \
  -path './.git' -prune -o \
  -path './scripts' -prune -o \
  -path './**/node_modules' -prune -o \
  -path './**/.venv' -prune -o \
  -type f -print0)

echo "Lightweight secret scan passed."
