# UK Trades AI Receptionist — V1

Middleware, configuration and tooling for the GHL native Voice AI receptionist.
Spec: `UK Trades AI Receptionist — V1 Build Plan` (PDF) and [claude.md](claude.md).
Plan: [docs/V1_IMPLEMENTATION_PLAN.md](docs/V1_IMPLEMENTATION_PLAN.md) · Decisions/API: [docs/architecture.md](docs/architecture.md)

## Run locally

```bash
npm ci
cp .env.example .env            # set secrets (32+ chars)
set -a; . ./.env; set +a
npm run dev
```

Requires Node 20+ and Redis.

## Checks

```bash
npm run ci                      # format, lint, typecheck, all tests, config validation
npm run validate:config         # validate config/clients/*.yaml
```

Tests start a throwaway `redis-server` automatically, or use `TEST_REDIS_URL`.

## Layout

| Path                              | Contents                                                       |
| --------------------------------- | -------------------------------------------------------------- |
| `src/core`                        | outcome codes, urgency, job types, error codes                 |
| `src/domain`                      | postcode, service area, Europe/London hours, escalation matrix |
| `src/actions`, `src/routes`       | Voice AI custom-action handlers and HTTP routes                |
| `src/observability`               | logging, metrics, latency timing                               |
| `src/security`, `src/store`       | webhook auth, Redis, idempotency                               |
| `config/schema`, `config/clients` | business config model and per-client YAML                      |
| `tests/`                          | unit, integration, failure, security suites                    |
