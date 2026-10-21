#!/usr/bin/env bash
# Deploys the middleware to Fly.io in London. Alternative to deploy/cloudrun/deploy.sh.
#
#   ENVIRONMENT=production VERSION=v1.1.0 deploy/fly/deploy.sh
#
# One-time: `fly auth login` (opens a browser; the account needs a payment card), then put the
# environment's secrets in deploy/fly/secrets.<env>.env (git-ignored), one KEY=value per line:
#   WEBHOOK_SECRETS, METRICS_TOKEN, GHL_TOKENS (JSON), REDIS_URL (rediss://...), optionally
#   ALERT_SMS_OVERRIDES (demo only). `fly redis create --region lhr` gives a London Upstash Redis.
set -euo pipefail
cd "$(dirname "$0")"

: "${ENVIRONMENT:?set ENVIRONMENT (dev|qa|production)}"
: "${VERSION:?set VERSION (e.g. v1.1.0)}"
case "$ENVIRONMENT" in dev|qa|production) ;; *) echo "ENVIRONMENT must be dev, qa or production" >&2; exit 1 ;; esac
APP="${FLY_APP:-annie-api-${ENVIRONMENT}}"
SECRETS="secrets.${ENVIRONMENT}.env"

fly auth whoami >/dev/null || { echo "run: fly auth login" >&2; exit 1; }
[ -f "$SECRETS" ] || { echo "missing deploy/fly/$SECRETS (see header)" >&2; exit 1; }

if [ "$ENVIRONMENT" = "production" ]; then
  git diff --quiet && git diff --cached --quiet || { echo "working tree not clean" >&2; exit 1; }
  [ "$(git describe --tags --exact-match 2>/dev/null)" = "$VERSION" ] || { echo "HEAD is not tagged $VERSION" >&2; exit 1; }
fi

echo "==> checks"
(cd ../.. && npm ci --silent && npm run ci)

fly apps list --json | grep -q "\"${APP}\"" || fly apps create "$APP"
echo "==> secrets (values not printed)"
fly secrets import --app "$APP" --stage < "$SECRETS"

echo "==> deploy ${APP} ${VERSION}"
fly deploy --config fly.toml --app "$APP" --remote-only \
  --env "APP_ENV=${ENVIRONMENT}" --env "RELEASE_VERSION=${VERSION}"

URL="https://${APP}.fly.dev"
for i in 1 2 3 4 5 6; do
  if curl -fsS --max-time 5 "${URL}/readyz" | grep -q '"ready"'; then
    echo "ready: ${URL}"
    echo "Next: MIDDLEWARE_URL=${URL} npx tsx tools/demo/provision.ts && MIDDLEWARE_URL=${URL} npx tsx tools/demo/verify.ts"
    exit 0
  fi
  sleep 5
done
echo "readiness failed — roll back: fly releases --app ${APP}; fly deploy --image <previous image> --app ${APP}" >&2
exit 1
