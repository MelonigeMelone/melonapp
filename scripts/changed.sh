#!/usr/bin/env bash
set -euo pipefail

if git diff --name-only HEAD^1 HEAD | grep -qE "$1"; then
  run=true
else
  run=false
fi
echo "run=$run" >> "${GITHUB_OUTPUT:-/dev/stdout}"
echo "changes matching $1: $run"
