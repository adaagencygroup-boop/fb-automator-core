#!/bin/bash
set -e
cd "$(cd "$(dirname "$0")" && pwd)"
if [ ! -f compose.yml ]; then
  echo "Missing compose.yml In $(pwd)"
  exit 1
fi
rm -rf \
  .github \
  frontend \
  scripts \
  tauri \
  .venv \
  venv \
  start.py \
  .env.example
find . \( -path "./.git" -o -path "*/node_modules" \) -prune -o \( -type d -name "__pycache__" -prune -o -type f \( -name "*.md" -o -name "*.excalidraw" \) \) -exec rm -rf {} + 2>/dev/null || true
echo "VPS Cleanup Complete"
docker compose build --parallel=false app admin
docker compose up -d --remove-orphans app admin
docker compose restart nginx
echo "docker system prune -a -f && docker builder prune -a -f"
docker compose ps