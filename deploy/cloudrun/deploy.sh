#!/usr/bin/env bash
# Deploys the middleware to Google Cloud Run in London (europe-west2). T-803.
#
#   PROJECT=my-gcp-project ENVIRONMENT=production VERSION=v1.0.0 deploy/cloudrun/deploy.sh
#
# Prerequisites (once per project, see docs/deploy/cloud-run.md):
#   - gcloud CLI authenticated; APIs enabled: run, artifactregistry, cloudbuild, secretmanager
#   - Secrets in Secret Manager (never in this script or the repo):
#       annie-<env>-webhook-secrets   comma-separated, current first (32+ chars each)
#       annie-<env>-metrics-token
#       annie-<env>-ghl-tokens        JSON: {"<locationId>":"<private integration token>", ...}
#       annie-<env>-redis-url         rediss://... (managed Redis in a UK/EU region)
set -euo pipefail

: "${PROJECT:?set PROJECT}"
: "${ENVIRONMENT:?set ENVIRONMENT (dev|qa|production)}"
: "${VERSION:?set VERSION (e.g. v1.0.0, must match the git tag)}"
REGION="${REGION:-europe-west2}"
SERVICE="annie-api-${ENVIRONMENT}"
REPO="${REPO:-annie}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/annie-api:${VERSION}"
MIN_INSTANCES="${MIN_INSTANCES:-2}"   # >=2: no cold start on the call path, survives a zone loss
MAX_INSTANCES="${MAX_INSTANCES:-20}"
CONCURRENCY="${CONCURRENCY:-200}"     # one instance measured ~11.7k rps; 200 in-flight is conservative

case "$ENVIRONMENT" in dev|qa|production) ;; *) echo "ENVIRONMENT must be dev, qa or production" >&2; exit 1 ;; esac

if [ "$ENVIRONMENT" = "production" ]; then
  # Production only ships a clean, tagged, CI-green commit.
  git diff --quiet && git diff --cached --quiet || { echo "working tree not clean" >&2; exit 1; }
  [ "$(git describe --tags --exact-match 2>/dev/null)" = "$VERSION" ] || { echo "HEAD is not tagged $VERSION" >&2; exit 1; }
fi

echo "==> checks"
npm ci --silent
npm run ci

echo "==> image ${IMAGE}"
gcloud artifacts repositories describe "$REPO" --project "$PROJECT" --location "$REGION" >/dev/null 2>&1 ||
  gcloud artifacts repositories create "$REPO" --project "$PROJECT" --location "$REGION" --repository-format docker
gcloud builds submit --project "$PROJECT" --region "$REGION" --tag "$IMAGE" .

echo "==> deploy ${SERVICE} (${REGION})"
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --image "$IMAGE" \
  --port 8080 \
  --cpu 1 --memory 512Mi \
  --no-cpu-throttling \
  --min-instances "$MIN_INSTANCES" --max-instances "$MAX_INSTANCES" \
  --concurrency "$CONCURRENCY" \
  --timeout 30 \
  --allow-unauthenticated \
  --set-env-vars "APP_ENV=${ENVIRONMENT},RELEASE_VERSION=${VERSION},LOG_LEVEL=info" \
  --set-secrets "WEBHOOK_SECRETS=annie-${ENVIRONMENT}-webhook-secrets:latest,METRICS_TOKEN=annie-${ENVIRONMENT}-metrics-token:latest,GHL_TOKENS=annie-${ENVIRONMENT}-ghl-tokens:latest,REDIS_URL=annie-${ENVIRONMENT}-redis-url:latest"
# --allow-unauthenticated: GHL must reach the actions; every /v1 route enforces the shared secret.

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"
echo "==> smoke test ${URL}"
for i in 1 2 3 4 5 6; do
  if curl -fsS --max-time 5 "${URL}/readyz" | grep -q '"ready"'; then
    echo "ready"
    echo
    echo "Next: MIDDLEWARE_URL=${URL} npx tsx tools/demo/provision.ts   (per sub-account env file)"
    echo "      MIDDLEWARE_URL=${URL} npx tsx tools/demo/verify.ts"
    exit 0
  fi
  sleep 5
done
echo "readiness check failed — roll back with:" >&2
echo "  gcloud run services update-traffic ${SERVICE} --project ${PROJECT} --region ${REGION} --to-revisions <previous-revision>=100" >&2
exit 1
