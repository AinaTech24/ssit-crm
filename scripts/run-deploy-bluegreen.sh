#!/bin/bash
# Zero-downtime blue-green deploy for the single-box prod stack.
# Installed on the server as ~/run-deploy.sh. Run detached:
#   nohup bash ~/run-deploy.sh > ~/deploy-current.log 2>&1 &
# then poll ~/deploy-current.log for DEPLOY_DONE_EXIT=0.
#
# Flow: prune -> build (heap-bounded) -> migrate -> start IDLE colour ->
#       wait until it's healthy -> stop the OLD colour. Caddy load-balances
#       across both colours with retry, so users never see the cutover.
# Safety: if the new colour never turns healthy, we stop it and LEAVE the old
#         colour serving — a failed deploy causes ZERO downtime.
exec > ~/deploy-current.log 2>&1
cd ~/app || { echo "DEPLOY_DONE_EXIT=1 (no ~/app)"; exit 1; }

COMPOSE="docker compose -f docker-compose.prod.yml"
STATE=~/app/.active-color

echo "=== prune $(date) ==="
# Keep the layer cache. `builder prune -af` discarded it on EVERY run, turning a
# two-line change into a full ~12-minute cold Next.js build. Evict only cache
# older than a week instead - and fall back to the full wipe when the disk is
# genuinely tight, which is the problem -a was really guarding against on a 40 GB
# root volume.
DISK_PCT=$(df --output=pcent / | tail -1 | tr -dc "0-9")
if [ "${DISK_PCT:-0}" -ge 85 ]; then
  echo "disk at ${DISK_PCT}% - full builder prune"
  docker builder prune -af 2>&1 | tail -1
else
  docker builder prune -f --filter until=168h 2>&1 | tail -1
fi
docker image prune -f 2>&1 | tail -1
echo "--- mem ---"; free -m | grep -E "Mem|Swap"

echo "=== build $(date) ==="
APP_URL=$(grep -E "^NEXT_PUBLIC_APP_URL=" .env | head -1 | sed 's/^[^=]*=//; s/^"//; s/"$//')
SITE_URL=$(grep -E "^NEXT_PUBLIC_SITE_URL=" .env | head -1 | sed 's/^[^=]*=//; s/^"//; s/"$//')
S3_URL=$(grep -E "^NEXT_PUBLIC_S3_PUBLIC_URL=" .env | head -1 | sed 's/^[^=]*=//; s/^"//; s/"$//')
docker build -t mfd-app:latest \
  --build-arg NEXT_PUBLIC_APP_URL="$APP_URL" \
  --build-arg NEXT_PUBLIC_SITE_URL="$SITE_URL" \
  --build-arg NEXT_PUBLIC_S3_PUBLIC_URL="$S3_URL" .
RC=$?; [ $RC -ne 0 ] && { echo "DEPLOY_DONE_EXIT=$RC (build failed — old colour still serving)"; exit $RC; }

# Typecheck gate. next.config sets typescript.ignoreBuildErrors, so `next build`
# succeeds even with type errors — that's how a silently-broken change can reach
# prod. Run tsc against the freshly-built image BEFORE migrating, so bad code
# never triggers a schema change and the old colour keeps serving.
# --incremental false: with incremental on, tsc tries to write tsconfig.tsbuildinfo
# into /app, which the unprivileged runtime user can't do (EACCES → false failure).
echo "=== typecheck $(date) ==="
$COMPOSE run --rm migrate npx tsc --noEmit --incremental false
RC=$?; [ $RC -ne 0 ] && { echo "DEPLOY_DONE_EXIT=$RC (type errors — old colour still serving)"; exit $RC; }

echo "=== migrate $(date) ==="
$COMPOSE run --rm migrate
RC=$?; [ $RC -ne 0 ] && { echo "DEPLOY_DONE_EXIT=$RC (migrate failed — old colour still serving)"; exit $RC; }

# Schema guard: fail the deploy if the ORM expects a table/column the DB lacks
# (the drift that 500'd every lead/client page when a migration shipped in code
# but not in the DB). Runs in the freshly-built image against the live DB.
echo "=== schema guard $(date) ==="
$COMPOSE run --rm migrate npm run check:schema
RC=$?; [ $RC -ne 0 ] && { echo "DEPLOY_DONE_EXIT=$RC (schema drift — code expects DB objects that don't exist; old colour still serving)"; exit $RC; }

# Shared services. The colour containers below start with --no-deps (so a
# deploy never restarts Caddy or Redis and drops connections), which means
# NOTHING starts them on a FIRST deploy: the run finishes DEPLOY_DONE_EXIT=0
# with a healthy web container and a site that answers on no port at all,
# because there is no reverse proxy and no queue backend. Idempotent - on a
# redeploy these are already up and compose leaves them alone.
echo "=== ensure shared services (caddy, redis) $(date) ==="
$COMPOSE up -d --no-deps caddy redis
RC=$?; [ $RC -ne 0 ] && { echo "DEPLOY_DONE_EXIT=$RC (could not start caddy/redis)"; exit $RC; }

ACTIVE=$(cat $STATE 2>/dev/null)
if [ "$ACTIVE" = "blue" ]; then TARGET=green; else TARGET=blue; fi
echo "=== active=${ACTIVE:-none} target=$TARGET $(date) ==="

echo "=== start $TARGET (new image) ==="
$COMPOSE --profile "$TARGET" up -d --no-deps "web-$TARGET"
RC=$?; [ $RC -ne 0 ] && { echo "DEPLOY_DONE_EXIT=$RC (could not start $TARGET — old colour still serving)"; exit $RC; }

echo "=== wait for $TARGET healthy ==="
ok=0
for i in $(seq 1 36); do  # up to ~3 min
  st=$(docker inspect --format '{{.State.Health.Status}}' "app-web-$TARGET" 2>/dev/null)
  echo "  [$i] app-web-$TARGET health=$st"
  [ "$st" = "healthy" ] && { ok=1; break; }
  sleep 5
done
if [ $ok -ne 1 ]; then
  echo "=== $TARGET never healthy — rolling back (old colour untouched) ==="
  $COMPOSE --profile "$TARGET" stop "web-$TARGET"
  echo "DEPLOY_DONE_EXIT=1 (new colour unhealthy — NO downtime, ${ACTIVE:-old} still serving)"
  exit 1
fi

# New colour healthy → Caddy is already routing to it. Stop the old colour.
if [ -n "$ACTIVE" ] && [ "$ACTIVE" != "$TARGET" ]; then
  echo "=== cutover: stop old colour $ACTIVE $(date) ==="
  $COMPOSE --profile "$ACTIVE" stop "web-$ACTIVE"
  $COMPOSE --profile "$ACTIVE" rm -f "web-$ACTIVE"
fi

echo "=== refresh worker to new image $(date) ==="
$COMPOSE up -d --no-deps worker

echo "$TARGET" > $STATE
echo "--- mem ---"; free -m | grep -E "Mem|Swap"
echo "=== done $(date) — active colour is now $TARGET ==="
echo "DEPLOY_DONE_EXIT=0"
