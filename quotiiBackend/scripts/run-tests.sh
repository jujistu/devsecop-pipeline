#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TEST_FILES=(
  src/__tests__/guest.auth.test.ts
  src/__tests__/http.api.test.ts
  src/__tests__/cloudIndex.status.test.ts
  src/__tests__/explain.sse.test.ts
  src/__tests__/bookIndex.test.ts
  src/__tests__/ask.sse.test.ts
  src/__tests__/summary.sse.test.ts
  src/__tests__/groundCitations.test.ts
  src/__tests__/upload.ownership.test.ts
  tests/objectStore.fake.test.ts
)

for file in "${TEST_FILES[@]}"; do
  echo "Running $file"
  npx ts-node "$file"
done

echo "All Node tests passed."
