#!/usr/bin/env bash
set -euo pipefail

echo "Checking PDF Processor..."
curl --fail --silent http://localhost:8000/health > /dev/null
echo "PDF Processor is healthy."

echo "Checking Node backend..."
curl --fail --silent http://localhost:3000/health > /dev/null
echo "Node backend is healthy."

echo "All API smoke tests passed."
