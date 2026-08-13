# Retaillink Terminals architecture

## System overview

```text
Merchant browser
    │ HttpOnly session
    ▼
Dashboard (Next.js :3000)
    │
    ├──────────────┐
    ▼              │
Payment API        │
(Fastify :3001)    │
    │              │
    ├─ Merchant/auth/RBAC
    ├─ Customers
    ├─ Payment Intents
    ├─ Risk evaluation
    ├─ Refunds
    ├─ Subscriptions / invoices
    ├─ Webhooks / retry
    ├─ Ledger / balance / settlement
    └─ Audit / API logs
    │
    ▼
PostgreSQL + Prisma

Merchant server
    │ sk_test_...
    ▼
Payment API

Customer browser
    │ checkout token
    ▼
Hosted Checkout (Next.js :3002)
    │
    ▼
Sandbox processor
```

## Trust boundaries

### Merchant dashboard session

The dashboard uses an HttpOnly session cookie. Browser-origin checks protect mutating session-authenticated requests.

The dashboard session is for merchant operators. It is not an API credential for third-party backend integrations.

### Secret API key

`sk_test_...` credentials are server-side sandbox integration credentials.

Rules:

- show a new secret only once
- store only the hash
- never put a secret key into browser JavaScript, URLs or logs
- revocation must take effect immediately

### Hosted checkout token

A checkout token identifies one Payment Intent. It is not a merchant API credential.

## Core money invariants

### Amounts

Money is stored as integer minor units.

For LKR in this sandbox:

```text
500000 => LKR 5,000.00
```

Do not store monetary values as floating-point database fields.

### Payment state

Do not replace the state machine with a boolean `paid` field.

Payment and Payment Intent status changes must be explicit and validated.

### Refunds

Total successful refunds must never exceed the original successful payment amount.

Concurrent refund operations must not allow an over-refund.

### Ledger

Ledger history is append-only.

Do not edit previous ledger entries to correct a transaction. Post a reversing/corrective entry instead.

Every logical money movement must balance debits and credits.

### Balance

Merchant available balance is derived from ledger entries, not from a mutable standalone balance number.

### Settlement

Settlement consumes merchant payable balance through ledger entries. It must not erase payment history.

## Idempotency

Create-payment operations support `Idempotency-Key`.

A replay using the same key must return the same logical result rather than create a duplicate payment.

When a Payment Intent is linked to a customer, the same idempotency key cannot be replayed with a different customer.

Production multi-instance idempotency should be enforced transactionally in the shared database/cache layer rather than by process-local locks.

## Customer data

Customer records may contain identity and merchant metadata.

They must not be used as a place to store card PAN, CVC, magnetic-stripe data or invented reusable payment credentials.

## Card data boundary

The current checkout recognises only synthetic sandbox test-card numbers.

Never modify the sandbox processor to accept arbitrary real card numbers.

Never store CVC/CVV.

A future live implementation should use the tokenisation/hosted-fields architecture required by the selected acquirer or processor.

## Risk

Risk rules run before Payment Intent or recurring-invoice generation.

- BLOCK rejects the operation.
- REVIEW records the decision and allows the sandbox operation.
- ALLOWED records that no rule blocked/reviewed the operation.

Risk events are operational records, not proof of production fraud prevention.

## Recurring billing

The sandbox subscription engine creates invoices and hosted checkout sessions.

It does not silently reuse a card.

A future off-session implementation requires an approved reusable payment credential/mandate design from the real payment processor/acquirer.

## Webhooks

Webhook events are signed with HMAC SHA-256 over:

```text
<timestamp>.<raw JSON body>
```

Delivery is at-least-once in principle; consumers should deduplicate using event IDs.

Before initial delivery and retry, webhook destinations must be checked against SSRF rules.

Production retry processing should move to a durable background queue.

## Team permissions

Expected role intent:

- OWNER — complete merchant control
- ADMIN — broad operational/developer administration
- DEVELOPER — integration/customer/payment creation actions
- FINANCE — financial operations such as refunds
- VIEWER — read only

Do not add a new mutating endpoint without deciding its RBAC policy.

## Audit and request logs

Audit logs record merchant-operator security/administrative actions.

API request logs store safe metadata only:

- request ID
- method
- route
- status
- authentication source
- duration
- timestamp

Do not store API keys, Authorization headers, card payloads or CVC values in request logs.

## Database migrations

Prisma migrations are committed to Git.

Normal deployment/update flow:

```bash
pnpm db:generate
pnpm db:deploy
```

`prisma migrate dev` is for intentionally authoring a schema migration, not for applying migrations that already exist in Git.

## Production processor abstraction

The core payment domain should continue to target a processor interface rather than importing bank-specific behaviour everywhere.

Conceptually:

```ts
interface PaymentProcessor {
  authorize(...args: unknown[]): Promise<unknown>;
  capture(...args: unknown[]): Promise<unknown>;
  cancel(...args: unknown[]): Promise<unknown>;
  refund(...args: unknown[]): Promise<unknown>;
}
```

The current deterministic demo processor is one implementation. Future acquirer integrations should remain isolated adapters behind this boundary.
