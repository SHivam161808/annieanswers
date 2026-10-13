# Deploying the middleware to Google Cloud Run (London) — T-803

The middleware is stateless; all shared state lives in Redis, and GHL is the system of record. It
runs as a container behind Cloud Run in `europe-west2` (London) and scales horizontally.

> Status: script written and syntax-checked; **not yet run** (needs a GCP project). The container
> has been tested via `npm run build` + `node dist/src/server.js`, not via `docker build`.

## One-time setup per environment (dev, qa, production)

1. **GCP project** with billing; install the `gcloud` CLI and `gcloud auth login`.
2. Enable APIs:
   `gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com`
3. **Redis in the UK/EU** (holds only idempotency keys and rate-limit counters, no caller data):
   a managed Redis with TLS in London (e.g. Redis Cloud / Upstash `eu-west-2`), giving a
   `rediss://` URL. Memorystore also works but needs a Serverless VPC connector (`--vpc-connector`).
4. **Secrets** (values never go in the repo, shell history or the script):
   ```
   printf '%s' "$(openssl rand -base64 36)"       | gcloud secrets create annie-production-webhook-secrets --data-file=-
   printf '%s' "$(openssl rand -base64 36)"       | gcloud secrets create annie-production-metrics-token --data-file=-
   printf '%s' '{"<locationId>":"<pit-token>"}'  | gcloud secrets create annie-production-ghl-tokens --data-file=-
   printf '%s' 'rediss://…'                       | gcloud secrets create annie-production-redis-url --data-file=-
   ```
   Grant the Cloud Run runtime service account `roles/secretmanager.secretAccessor`.
   Adding a client = add its location/token to `ghl-tokens` (new secret version) and redeploy.

## Deploy

```
PROJECT=<gcp-project> ENVIRONMENT=production VERSION=v1.0.0 deploy/cloudrun/deploy.sh
```

The script runs the full CI, builds the image with Cloud Build, deploys with 2–20 instances
(no cold start on the call path), and smoke-tests `/readyz`. Production deploys require a clean
tree and `HEAD` tagged `VERSION`.

Then point GHL at the new URL (per sub-account env file):

```
MIDDLEWARE_URL=https://annie-api-production-….run.app npx tsx tools/demo/provision.ts
MIDDLEWARE_URL=https://annie-api-production-….run.app npx tsx tools/demo/verify.ts
```

`check_service_area` and `escalation` have UI-added parameters (GHL API bug), so provisioning
skips them: **update their URL in the GHL screen** (Voice AI agent → Actions → edit → URL).

## Operations

| Need                | Where                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logs                | Cloud Logging; one JSON line per request (`request_completed`: correlation id, call id, action, status, `latency_ms`, error code). No caller data. |
| Metrics             | `GET /metrics` with `Authorization: Bearer <metrics token>` (Prometheus); scrape with Managed Service for Prometheus or any Prometheus.            |
| Health              | `/healthz` (liveness), `/readyz` (Redis + config).                                                                                                 |
| Rollback            | `gcloud run services update-traffic annie-api-production --to-revisions <previous>=100 --region europe-west2`                                      |
| Secret rotation     | Add the new secret first in `WEBHOOK_SECRETS` (`new,old`), deploy, update GHL actions, then remove `old`.                                          |
| Daily review/alerts | `.github/workflows/call-review.yml` (secrets `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID`, `TEAM_ALERT_WEBHOOK_URL`).                                    |

## Capacity (measured, not assumed)

One process (1 vCPU) sustained ~11.7k requests/s with 0 errors at 1,000 concurrent requests,
p99 125 ms (local load test, `npm run test:load`). A busy call makes 3–6 action requests over
several minutes, so request volume is not the limit — GHL's own API rate limits and per-minute
voice costs are. Re-run the load test against the deployed service before claiming any figure.
