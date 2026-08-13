# Retaillink Terminals

Sandbox-first payment gateway and merchant payment platform for developing and testing Sri Lankan payment integrations.

> **Sandbox only.** This repository does not process real money and must never be used with real card details or production payment credentials.

## Current capabilities

### Payments

- Payment Intent API with idempotency
- Hosted checkout
- Success, decline and simulated 3DS flows
- Payment history and detail
- Full and partial refunds
- Deterministic sandbox cards only
- LKR minor-unit amounts

### Merchant platform

- Merchant signup/login using HttpOnly sessions
- Multi-merchant memberships and account switching
- Team invitations and roles: `OWNER`, `ADMIN`, `DEVELOPER`, `FINANCE`, `VIEWER`
- Role-based access control on mutating merchant actions
- Customers API and dashboard
- Test secret API keys (`sk_test_...`) shown once and stored hashed
- Audit log
- API request metadata logs
- Business settings

### Risk

- Amount-threshold rules
- Merchant-reference text rules
- `BLOCK` and `REVIEW` actions
- BLOCK rules reject Payment Intent creation
- REVIEW rules allow the sandbox payment while recording a risk event
- Allowed/review/blocked decision history

### Money movement simulation

- Double-entry ledger
- Simulated gateway fee: `2.5% + LKR 30.00`
- Ledger-backed available balance
- Refund ledger reversals
- Demo settlements that reduce merchant payable balance

### Developer platform

- Signed HMAC webhooks
- Webhook delivery history
- SSRF protection for webhook destinations
- First-party JavaScript/TypeScript SDK in `packages/sdk-js`
- OpenAPI specification in `docs/openapi.yaml`
- GitHub Actions CI for frozen install, Prisma, seed, tests, typecheck and builds

## Applications

- `apps/api` — Fastify payment API on `http://localhost:3001`
- `apps/dashboard` — merchant dashboard on `http://localhost:3000`
- `apps/checkout` — hosted checkout on `http://localhost:3002`
- `packages/database` — Prisma schema and database client
- `packages/payment-core` — deterministic sandbox processor
- `packages/sdk-js` — JavaScript/TypeScript SDK

## Requirements

- Node.js 22 recommended
- pnpm 10
- Docker Desktop / Docker Engine
- PostgreSQL is provided through Docker Compose

For WSL development, use Linux Node/pnpm inside WSL rather than Windows Node binaries mounted into WSL.

## First-time local setup

```bash
git clone https://github.com/roshiend/retaillink-terminals.git
cd retaillink-terminals

pnpm install

cp packages/database/.env.example packages/database/.env
cp apps/api/.env.example apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env.local
cp apps/checkout/.env.example apps/checkout/.env.local

docker compose up -d postgres

pnpm db:generate
pnpm db:migrate --name init
pnpm db:seed

pnpm dev
```

Open:

- Merchant dashboard: `http://localhost:3000`
- API health: `http://localhost:3001/health`
- Hosted checkout: opened from a Payment Intent `checkout_url`

## Updating an existing local database

After pulling a version that changes the Prisma schema:

```bash
git pull
pnpm install
pnpm db:generate
pnpm db:migrate --name update
pnpm dev
```

Use a descriptive migration name when possible.

## Demo merchant

The seed creates a sandbox merchant account and prints its sandbox secret API key when a new key is created.

The seeded dashboard login is:

```text
Email: demo@retaillink.local
Password: Retaillink123!
```

Change or remove seeded credentials before sharing a deployed demo publicly.

## Sandbox cards

These numbers are recognised only by the deterministic local sandbox processor:

| Card | Result |
| --- | --- |
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 0002` | Declined payment |
| `4000 0025 0000 3155` | Simulated 3D Secure |

Use any future expiry date and any 3-digit CVC. Never enter a real card number.

## Create a Payment Intent

Amounts are supplied in the smallest currency unit. For LKR, `500000` represents `LKR 5,000.00`.

```bash
curl -X POST http://localhost:3001/v1/payment_intents \
  -H "Authorization: Bearer sk_test_REPLACE_ME" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-1001-payment" \
  -d '{
    "amount": 500000,
    "currency": "LKR",
    "merchant_reference": "ORDER-1001",
    "description": "Sandbox order"
  }'
```

The response contains a `checkout_url`. Open it and use one of the sandbox card numbers above.

## Customers

```bash
curl -X POST http://localhost:3001/v1/customers \
  -H "Authorization: Bearer sk_test_REPLACE_ME" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Nimal Perera",
    "email": "nimal@example.com",
    "phone": "+94770000000"
  }'
```

Customer records contain identity/metadata only. They do not store card numbers or CVCs.

## Webhooks

Create an endpoint:

```bash
curl -X POST http://localhost:3001/v1/webhook_endpoints \
  -H "Authorization: Bearer sk_test_REPLACE_ME" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.test/retaillink-webhook"}'
```

The returned `whsec_test_...` value is shown once and is used to verify:

```text
x-retaillink-signature: t=<timestamp>,v1=<hmac_sha256>
```

Signature input:

```text
<timestamp>.<raw JSON request body>
```

Current events include:

- `payment.succeeded`
- `refund.succeeded`

The sandbox currently performs immediate delivery attempts and records their result. Durable queue/retry infrastructure remains a production requirement.

## Dashboard modules

After signing in, the dashboard includes the main console plus additional modules:

- `/customers` — customer directory
- `/team` — team members and invitations
- `/risk` — risk rules and events
- `/api-logs` — safe API request metadata
- `/merchants` — merchant membership/account switching
- `/invite?token=...` — team invitation acceptance

## Role model

- **OWNER** — complete merchant control
- **ADMIN** — broad operational/developer administration
- **DEVELOPER** — payment creation, customers and integration management
- **FINANCE** — financial read access and refunds
- **VIEWER** — read-only access

Owner-only actions such as team administration, business settings and running settlements remain restricted even from other roles.

## Important production boundary

Before any real-money use, this architecture still requires at minimum:

- acquiring bank/processor integration
- appropriate Sri Lankan regulatory/legal authorisation and operating structure
- PCI DSS scope determination and compliance work
- hosted/tokenised card-data architecture designed with the real acquirer
- merchant onboarding/KYC/KYB
- production secrets management and key rotation
- durable event/webhook queues and retries
- stronger fraud/risk systems and operational review workflows
- reconciliation against processor/acquirer files
- real settlement/payout operations
- monitoring, alerting, backup and disaster recovery
- independent security review and penetration testing

Do not convert the sandbox card endpoint into a real card-processing endpoint.
