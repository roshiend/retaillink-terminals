# Retaillink Terminals

Sandbox-first payment gateway and merchant payment platform.

This repository currently implements a **demo/sandbox payment gateway only**. It does not process real money and must not be used with real card details.

## What is implemented

- Merchant/test API key model
- One-time sandbox secret key generation
- Payment Intent API
- Idempotency keys
- Hosted checkout
- Success, decline and simulated 3DS flows
- Payment records
- Refunds
- Merchant payment dashboard
- Signed webhooks
- Webhook delivery records
- Double-entry ledger entries for payments/refunds
- Settlement data model foundation
- PostgreSQL + Prisma

## Applications

- `apps/api` — Fastify payment gateway API on port `3001`
- `apps/dashboard` — merchant dashboard on port `3000`
- `apps/checkout` — hosted checkout on port `3002`
- `packages/database` — Prisma schema/database client
- `packages/payment-core` — deterministic sandbox processor

## Requirements

- Node.js 20+
- pnpm 10+
- Docker Desktop / Docker Engine

## Local setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create local environment files

macOS/Linux:

```bash
cp packages/database/.env.example packages/database/.env
cp apps/api/.env.example apps/api/.env
cp apps/dashboard/.env.example apps/dashboard/.env.local
cp apps/checkout/.env.example apps/checkout/.env.local
```

Windows PowerShell:

```powershell
Copy-Item packages/database/.env.example packages/database/.env
Copy-Item apps/api/.env.example apps/api/.env
Copy-Item apps/dashboard/.env.example apps/dashboard/.env.local
Copy-Item apps/checkout/.env.example apps/checkout/.env.local
```

### 3. Start PostgreSQL

```bash
docker compose up -d postgres
```

### 4. Generate Prisma client and create the database

```bash
pnpm db:generate
pnpm db:migrate --name init
```

### 5. Seed the sandbox merchant

```bash
pnpm db:seed
```

The seed prints a secret key beginning with:

```text
sk_test_...
```

Copy it immediately. Only a SHA-256 hash is stored in the database, so the full key cannot be retrieved later.

### 6. Start everything

```bash
pnpm dev
```

Open:

- Dashboard: `http://localhost:3000`
- API health: `http://localhost:3001/health`
- Checkout: opened from a Payment Intent checkout URL

Enter the generated `sk_test_...` key in the dashboard.

## Sandbox cards

These numbers are recognised **only by the local demo processor**:

| Card | Result |
| --- | --- |
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 0002` | Declined payment |
| `4000 0025 0000 3155` | Simulated 3D Secure |

Use any future expiry date and any 3-digit CVC. Never enter a real card number.

## Create a Payment Intent through the API

Amounts are supplied in the smallest currency unit. For example `500000` represents `LKR 5,000.00`.

```bash
curl -X POST http://localhost:3001/v1/payment_intents \
  -H "Authorization: Bearer sk_test_REPLACE_ME" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-1001-payment" \
  -d '{
    "amount": 500000,
    "currency": "LKR",
    "merchant_reference": "ORDER-1001",
    "description": "Demo order"
  }'
```

The response includes a `checkout_url`. Open it in a browser and use a sandbox card.

## Webhooks

Create an endpoint:

```bash
curl -X POST http://localhost:3001/v1/webhook_endpoints \
  -H "Authorization: Bearer sk_test_REPLACE_ME" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.test/retaillink-webhook"}'
```

The returned `whsec_test_...` value is the endpoint signing secret. Webhook requests include:

```text
x-retaillink-signature: t=<timestamp>,v1=<hmac_sha256>
```

The signature input is:

```text
<timestamp>.<raw JSON request body>
```

Current events include:

- `payment.succeeded`
- `refund.succeeded`

The current sandbox performs one immediate webhook attempt and records delivery success/failure. A production version should move retries to a durable queue.

## Sandbox fee/ledger model

Successful LKR payments currently simulate a gateway fee of:

```text
2.5% + LKR 30.00
```

Ledger posting uses balanced entries across processor clearing, merchant payable and fee revenue accounts. Refunds reverse the refundable payment amount between merchant payable and processor clearing.

## Important production boundary

This codebase is intentionally a sandbox. Before any real-money use, the architecture needs at minimum:

- acquiring bank/processor integration
- Sri Lankan legal and regulatory approval/structure
- PCI DSS scope determination and compliance work
- secure card-data/tokenisation architecture
- production identity/authentication and merchant onboarding/KYC
- secrets management and key rotation
- durable webhook/event queues and retries
- fraud/risk controls
- reconciliation and settlement operations
- observability, alerting, backups and disaster recovery
- independent security review and penetration testing

Do not convert the current test card endpoint into a real card-processing endpoint.
