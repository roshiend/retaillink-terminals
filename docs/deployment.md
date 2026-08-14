# Retaillink Terminals deployment runbook

This runbook describes deployment of the **sandbox/test platform** in a production-style environment. It does not authorise live card or real-money processing.

## Service topology

Deploy four application processes:

1. **API** — Fastify, port 3001 internally.
2. **Dashboard** — Next.js, port 3000 internally.
3. **Checkout** — Next.js, port 3002 internally.
4. **Worker** — private background process with no public port. It advances due subscription billing cycles and processes/retries webhook deliveries.

Use an external managed PostgreSQL database. Put API, Dashboard and Checkout behind a managed HTTPS load balancer/ingress. Keep Worker and PostgreSQL on private networks.

## Required production configuration

The API intentionally refuses to start in `NODE_ENV=production` unless the following safety requirements are met:

- `DATABASE_URL` exists.
- `CHECKOUT_BASE_URL` uses HTTPS.
- every `DASHBOARD_ORIGIN` uses HTTPS.
- `REQUIRE_IDEMPOTENCY_KEYS=true`.
- `WEBHOOK_SECRET_ENCRYPTION_KEY` is a base64-encoded 32-byte key.

Generate the webhook encryption key once and store it in the deployment secret manager:

```bash
openssl rand -base64 32
```

The API and Worker must receive the **same** encryption key. Losing the key prevents decryption of encrypted webhook signing secrets. Back up the key through the organisation's approved secrets-management process; never put it in Git.

See `infrastructure/production/.env.production.example` for the full runtime configuration surface.

## Build

The reference Dockerfiles are:

```text
infrastructure/docker/Dockerfile.api
infrastructure/docker/Dockerfile.worker
infrastructure/docker/Dockerfile.dashboard
infrastructure/docker/Dockerfile.checkout
```

CI builds all four images after migrations, tests, typechecking and application builds succeed.

Build frontend images with the public API HTTPS URL at build time:

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
  -f infrastructure/docker/Dockerfile.dashboard \
  -t retaillink-dashboard:<version> .

docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
  -f infrastructure/docker/Dockerfile.checkout \
  -t retaillink-checkout:<version> .
```

## Database deployment

Database migrations are the deployment source of truth. Do not use `prisma db push` in production.

Run exactly one migration job before rolling application containers:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
```

For containers, use the same immutable release image/code revision as the API release when executing the migration command.

Migration policy:

- Prefer backward-compatible additive migrations.
- Deploy schema expansion before code that requires it.
- Perform destructive cleanup only in a later release after old code is no longer running.
- Do not automatically roll a database backward after a failed application rollout.
- Test restore procedures on a non-production database.

## Rollout order

Recommended order for an additive release:

1. Confirm managed PostgreSQL backup/point-in-time recovery is healthy.
2. Run `prisma migrate deploy` once.
3. Roll out Worker.
4. Roll out API.
5. Verify API `/health` and `/ready`.
6. Roll out Dashboard and Checkout.
7. Run smoke tests against sandbox Payment Intents, checkout, webhook enqueue/delivery and dashboard login.
8. Watch error rate, latency, worker failures, database connections and webhook backlog before completing the release.

## Health checks

API exposes two different checks:

- `/health` — process liveness. It does not require PostgreSQL.
- `/ready` — readiness. It verifies PostgreSQL with `SELECT 1` and returns 503 if the database is unavailable.

Load balancers should remove an API instance from service when `/ready` fails, while container/process supervision should use liveness/restart behaviour separately.

The Worker has no public HTTP listener. Its process exit status is its liveness signal. Monitor worker logs and delivery/billing backlog as operational health signals.

## Graceful shutdown

API and Worker listen for `SIGTERM`/`SIGINT` and disconnect Prisma cleanly. Configure a shutdown grace period of at least 30 seconds at the orchestration layer.

## Network controls

Production expectations:

- TLS terminates only at approved ingress/load balancers and all public traffic is HTTPS.
- API, Dashboard and Checkout containers are not directly internet-addressable outside the ingress path.
- Worker has no public port.
- PostgreSQL accepts traffic only from application/migration networks.
- `TRUST_PROXY=true` is safe only when direct access to API instances is blocked and trusted ingress is the sole source of forwarded headers.
- Put a distributed/edge rate limiter or WAF in front of the API. The built-in application rate limiter is per-process defense-in-depth and is **not** a cross-replica global quota.

## Request safety

Production enables or requires:

- refund `Idempotency-Key` persistence;
- existing Payment Intent idempotency controls;
- request-body size limits;
- origin checks for session-authenticated writes;
- RBAC;
- HSTS and defensive response headers;
- strict synthetic sandbox-card allow-listing;
- webhook SSRF validation before creation/retry/worker delivery;
- HTTPS-only webhook endpoints in production;
- encrypted webhook signing secrets at rest.

## Webhook worker

Webhook deliveries are durable database records. Worker processing uses atomic claims, bounded retries and exponential backoff. A stale processing claim can be recovered after `WEBHOOK_CLAIM_TTL_MS`.

Key worker settings:

```text
WORKER_POLL_MS
WEBHOOK_WORKER_BATCH_SIZE
WEBHOOK_MAX_ATTEMPTS
WEBHOOK_RETRY_BASE_MS
WEBHOOK_RETRY_MAX_MS
WEBHOOK_CLAIM_TTL_MS
WEBHOOK_TIMEOUT_MS
BILLING_WORKER_BATCH_SIZE
```

Manual delivery retry remains available from the merchant console and re-validates the destination.

## Recurring billing worker

Due ACTIVE subscriptions are picked from PostgreSQL. The worker:

- honours `cancel_at_period_end`;
- evaluates sandbox risk rules;
- pauses the subscription on a BLOCK decision;
- creates the next invoice and Payment Intent under a serializable transaction;
- advances the subscription period;
- writes system audit records.

A paused subscription can be resumed by an authorised merchant. If its blocking rule still matches when it becomes due, the scheduler will pause it again.

## Backups and recovery

Before any serious external sandbox use:

- enable managed PostgreSQL automated backups and point-in-time recovery;
- define recovery point and recovery time objectives;
- test restoring a backup into an isolated environment;
- back up deployment configuration and encryption keys through approved secret-management procedures;
- monitor storage growth for ledger, audit, request-log, idempotency and webhook-delivery tables;
- define retention/archival policies before volumes become large.

## Observability and alerting

At minimum alert on:

- API 5xx rate;
- `/ready` failures;
- database saturation/connection failures;
- p95/p99 API latency;
- worker fatal/repeated batch errors;
- growing FAILED/PENDING webhook backlog;
- subscriptions that remain due/paused unexpectedly;
- abnormal risk-block rate;
- settlement/ledger reconciliation mismatches;
- authentication abuse/rate-limit spikes.

Do not log API secret keys, session cookies, webhook signing secrets, CVV values, or complete card data.

## Smoke test after deployment

Using only synthetic sandbox data:

1. Sign in to the merchant dashboard.
2. Create a Payment Link or Payment Intent.
3. Complete hosted checkout with a documented synthetic success card.
4. Verify payment, ledger and Finance views.
5. Issue an idempotent partial refund and replay the same key.
6. Verify the same refund is returned and ledger balances reconcile.
7. Configure a controlled public HTTPS webhook receiver.
8. Trigger an event and confirm the Worker delivers it with a valid signature.
9. Create a due subscription in a test merchant and verify automatic invoice generation.

## Rollback

Application rollback should normally deploy the previous immutable images **without reversing already-applied additive database migrations**. If a migration is incompatible with the previous version, the release design was not backward-compatible and requires a controlled forward fix.

For data corruption or destructive migration incidents, follow the database restore/runbook process rather than improvising SQL reversals on a live payment ledger.
