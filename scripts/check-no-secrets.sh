#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --source . --redact --no-banner --exit-code 1
  echo "Gitleaks secret scan passed."
  exit 0
fi

echo "Gitleaks not installed; running lightweight pattern scan."

# ---------------------------------------------------------------------------
# Pattern design rules:
#   MUST match:   real credentials with actual values
#   MUST NOT match:
#     - empty assignments:          KEY=
#     - obvious placeholder words:  USER PASSWORD HOST DB ACCOUNT_ID YOUR_*
#     - ellipsis placeholders:      \n...\n  or  ...
#     - angle-bracket tokens:       <something>
#     - commented-out lines:        # KEY="-----BEGIN..."
# ---------------------------------------------------------------------------

# Real AWS/R2 access key ID: AKIA followed by exactly 16 uppercase alphanumerics.
PAT_AWS='AKIA[0-9A-Z]{16}'

# Real PEM private key in .env escaped form: the two-char sequence \n (backslash
# then n) appears between the header and base64 payload.
# Placeholder form is \n...\n — the base64 requirement (>=10 alnum chars) rules
# that out. Commented lines start with # so we exclude them with [^#].
PAT_PEM_ESCAPED='[^#]BEGIN [A-Z ]*PRIVATE KEY-----\\n[A-Za-z0-9+/=]{10}'

# Real PEM header on its own literal line (not escaped, not commented).
PAT_PEM_LITERAL='^[^#]*-----BEGIN [A-Z ]*PRIVATE KEY-----$'

# Firebase / GCP service-account JSON — "type": "service_account" only appears
# in real credential files, never in documentation.
PAT_FIREBASE='"type"[[:space:]]*:[[:space:]]*"service_account"'

# Non-empty secret variable assignment.
# Matches:  VARNAME=somevalue  or  VARNAME="somevalue"
# The value must be >=8 chars so short words like "auto" or "true" don't fire.
PAT_SECRET_VAR='(JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|JWT_SECRET|SECRET_KEY|API_KEY|ACCESS_KEY_ID|SECRET_ACCESS_KEY|PRIVATE_KEY|AUTH_TOKEN|BEARER_TOKEN|GITHUB_TOKEN|SONAR_TOKEN|DEEPSEEK_API_KEY|UNSPLASH_ACCESS_KEY|EXPO_ACCESS_TOKEN)=.{8,}'

# RHS values that are documentation placeholders even when >=8 chars long.
PAT_PLACEHOLDER='(USER|PASSWORD|HOST|DB|ACCOUNT_ID|YOUR_|<|>|\.\.\.|redis://|localhost|development|production|nuggets-dev|-----BEGIN)'

found=0

while IFS= read -r -d '' file; do
  case "$file" in
    *.png|*.jpg|*.jpeg|*.gif|*.pdf|*.tar|*.gz|*.zip|yarn.lock|package-lock.json)
      continue
      ;;
  esac

  # --- AWS key ---
  if grep -E -q -- "$PAT_AWS" "$file" 2>/dev/null; then
    echo "Potential secret (AWS access key ID) in ${file}" >&2
    found=1
  fi

  # --- PEM key with base64 payload (escaped \n form) ---
  if grep -E -q -- "$PAT_PEM_ESCAPED" "$file" 2>/dev/null; then
    echo "Potential secret (PEM private key with payload) in ${file}" >&2
    found=1
  fi

  # --- PEM key header on a literal line (not commented) ---
  if grep -E -q -- "$PAT_PEM_LITERAL" "$file" 2>/dev/null; then
    echo "Potential secret (PEM private key header) in ${file}" >&2
    found=1
  fi

  # --- Firebase service account ---
  if grep -E -q -- "$PAT_FIREBASE" "$file" 2>/dev/null; then
    echo "Potential secret (Firebase service account JSON) in ${file}" >&2
    found=1
  fi

  # --- Non-empty secret variable: check each matching line individually ---
  while IFS= read -r line; do
    # Extract the RHS (everything after the first =)
    rhs="${line#*=}"
    # Strip one layer of surrounding quotes
    rhs="${rhs#\"}" ; rhs="${rhs%\"}"
    rhs="${rhs#\'}" ; rhs="${rhs%\'}"
    # Skip if the RHS looks like a placeholder
    if echo "$rhs" | grep -E -q -- "$PAT_PLACEHOLDER"; then
      continue
    fi
    echo "Potential secret (non-empty secret variable) in ${file}" >&2
    found=1
  done < <(grep -E -- "$PAT_SECRET_VAR" "$file" 2>/dev/null || true)

done < <(find . \
  -path './.git'              -prune -o \
  -path './scripts'           -prune -o \
  -path './**/node_modules'   -prune -o \
  -path './**/.venv'          -prune -o \
  -type f -print0)

if [[ "$found" -eq 1 ]]; then
  exit 1
fi

echo "Lightweight secret scan passed."
