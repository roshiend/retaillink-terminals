# Retaillink Terminals Sandbox v0.2

This document defines the completion boundary for the current developer sandbox.

## Status

Retaillink Terminals v0.2 is a **payment-gateway simulation and merchant integration environment**. It is intentionally not a real-money payment processor.

## Merchant account platform

Implemented:

- merchant signup/login
- HttpOnly sessions
- multi-merchant memberships
- merchant switching
- team invitations
- roles: OWNER, ADMIN, DEVELOPER, FINANCE, VIEWER
- role-based mutation permissions
- browser-origin checking for session-authenticated writes
- audit logs
- business settings

## Developer platform

Implemented:

- `sk_test_...` secret API keys
- one-time secret display
- SHA-256 hashed secret storage
- API request metadata logs
- first-party TypeScript/JavaScript SDK
- recurring-billing SDK module
- OpenAPI documentation
- signed HMAC webhooks
- webhook delivery records
- manual webhook retry with destination re-validation
- SSRF protection for webhook targets

## Payments

Implemented:

- Payment Intents
- idempotency keys
- customer-linked Payment Intents
- hosted checkout
- deterministic synthetic card outcomes
- simulated 3DS challenge flow
- successful and failed payment records
- payment detail
- full and partial refunds
- refund concurrency protections

## Customers

Implemented:

- create/list/retrieve/update/delete
- merchant ownership isolation
- reusable customer association to Payment Intents
- metadata support
- no storage of payment-card credentials

## Risk

Implemented:

- amount threshold rules
- merchant-reference text rules
- BLOCK actions
- REVIEW actions
- ALLOWED/REVIEW/BLOCKED event history
- enforcement on ordinary Payment Intent creation
- enforcement on recurring invoice generation

## Ledger and settlements

Implemented:

- immutable double-entry ledger entries
- merchant payable account
- processor clearing account
- fee revenue account
- simulated `2.5% + LKR 30.00` fee
- refund ledger reversals
- ledger-backed available balance
- sandbox settlement execution
- settlement history

## Recurring billing

Implemented:

- subscriptions
- day/week/month/year intervals
- invoice generation
- hosted invoice checkout
- invoice payment synchronisation
- invoice voiding
- cancel immediately
- cancel at period end
- test-only next-cycle scheduler simulation
- shared risk-rule evaluation

Recurring billing deliberately does **not** create or store reusable live-card credentials.

## Merchant UI

Implemented modules include:

- payments overview
- payments/refunds
- settlements
- API keys
- webhooks
- audit log
- settings
- customers
- billing
- team
- risk
- API logs
- webhook delivery retry console
- merchant switching
- consolidated console hub
- analytics and CSV payment export

## Engineering quality

Implemented:

- PostgreSQL + Prisma
- committed database migrations
- `prisma migrate deploy` deployment workflow
- Docker Compose local PostgreSQL
- automated integration/security tests
- TypeScript typechecking
- Next.js production builds
- SDK build
- GitHub Actions CI

## Not part of sandbox v0.2

The following are explicitly deferred to a future production/acquirer phase:

- real Visa/Mastercard processing
- real bank/acquirer connectivity
- live API keys
- real PAN/CVC handling
- network/acquirer tokenisation
- off-session real-card charging
- actual 3DS certification
- merchant KYC/KYB
- real bank settlement files
- processor reconciliation
- disputes/chargebacks
- production fraud operations or ML
- production scheduler/worker infrastructure
- durable distributed webhook retry queues
- production secrets vault/KMS
- full observability/alerting/incident response
- independent penetration test
- PCI DSS production scope/compliance work
- Sri Lankan regulatory/licensing/authorisation work

## Production principle

A future live version should replace the deterministic sandbox processor behind a processor/acquirer abstraction. It should not turn the current synthetic-card endpoint into a live card endpoint.
