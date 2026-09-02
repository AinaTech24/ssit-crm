#!/usr/bin/env bash
#
# One-command production redeploy on the EC2 box.
#   pull deploy/aws  →  rebuild image  →  run migrations (auto via the `migrate`
#   service)  →  restart web + worker  →  health-check.
#
# Usage (on the server, from the repo root):
#   bash scripts/redeploy.sh
#
# This is also what the GitHub Actions deploy workflow runs over SSH on every
# push to deploy/aws (once the DEPLOY_SSH_* repo secrets are set).

set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml"

echo "▸ Pulling latest deploy/aws…"
git fetch origin deploy/aws
git checkout deploy/aws
git pull --ff-only origin deploy/aws

echo "▸ Build image + run migrations + restart…"
# The `migrate` one-shot service runs `npm run migrate:all` and web/worker
# depend on it completing successfully, so migrations apply automatically here.
$COMPOSE up -d --build

echo "▸ Pruning dangling images…"
docker image prune -f >/dev/null 2>&1 || true

echo "▸ Health check…"
sleep 6
if $COMPOSE exec -T web curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then
  echo "✓ Deployed and healthy."
else
  echo "⚠ App not healthy yet — check logs: $COMPOSE logs --tail=50 web migrate"
  exit 1
fi
