# Production readiness

Retaillink Terminals has two different meanings of “production ready.” They must never be conflated.

## 1. Production-grade sandbox software

This means the TEST platform can be deployed and operated reliably for merchants/developers without moving real money or accepting real card credentials.

### Implemented in the codebase

- PostgreSQL-backed merchant, customer, payment, refund, subscription, invoice and accounting state.
- Committed Prisma migration history and `migrate deploy` deployment flow.
- Payment Intent state machine and cancellation controls.
- Payment Links with crawler-safe read-only landing pages.
- Hosted checkout restricted to documented synthetic sandbox cards.
- Payment and refund concurrency protection.
- Persistent refund idempotency with request conflict detection and response replay.
- Session authentication, API-key authentication, RBAC and session-origin protection.
- Risk BLOCK/REVIEW rules and events.
- Immutable double-entry ledger postings for payments/refunds/settlements.
- Ledger-backed Finance/reconciliation endpoints and merchant UI.
- Audit logs and API request logs.
- Webhook destination SSRF checks, HMAC signatures, manual retry and durable background retry processing.
- Webhook signing-secret encryption at rest when the production encryption key is configured.
- Recurring invoices and a background scheduler for due subscriptions.
- Readiness/liveness endpoints and graceful shutdown.
- Request-body limits, security headers and application-level abuse throttling.
- Production Docker images for API, Worker, Dashboard and Checkout.
- CI validation of migrations, tests, typechecking, application builds and production images.

### Required before serious external sandbox traffic

Code alone cannot provide these infrastructure controls. A real deployment must additionally have:

- managed PostgreSQL with TLS, automated backups and tested point-in-time recovery;
- an HTTPS ingress/load balancer and managed certificates;
- a secrets manager for database credentials, encryption keys and future processor credentials;
- a distributed edge/WAF rate limit in addition to the per-process application limiter;
- central logs, metrics, traces/latency monitoring and alerting;
- a worker deployment with backlog/error monitoring;
- vulnerability/dependency scanning and image scanning;
- documented incident response and on-call ownership;
- tested backup restore and disaster-recovery procedures;
- data-retention/archival policy for audit, request, webhook and idempotency records;
- independent security testing before exposing the sandbox broadly.

## 2. Real-money production gateway

The repository must **not** be described as ready for live card or real-money processing until the following external and processor-specific work is completed.

### Acquiring/processor integration

- Contract with an acquiring bank/payment processor appropriate to the intended operating model.
- Certified/supported live processor adapter(s) behind the payment-processor abstraction.
- Processor-issued merchant/acquirer credentials stored in an approved secret/KMS system.
- Live authorisation/capture/refund/reversal behaviour and processor idempotency mapped correctly.
- Production 3DS/SCA flow provided by the acquirer/3DS provider, not the current simulator.
- Reconciliation against acquirer settlement files/API and bank credits.

### Card-data and PCI scope

- Final card-data architecture designed to minimise PCI scope, normally using acquirer/processor-hosted fields, tokenisation or equivalent approved components.
- No CVV storage under any circumstance.
- Do not reuse the sandbox card-entry path for real credentials.
- PCI DSS scope formally determined and required controls/assessment completed for the chosen architecture.
- Independent penetration testing and secure SDLC controls appropriate to the final scope.

### Legal/regulatory/compliance

Exact obligations depend on the final operating model and jurisdiction and must be confirmed with current official/legal sources before launch. At minimum the launch project needs:

- Sri Lankan legal/regulatory assessment for the actual payment-system/acquiring/service-provider model;
- all required approvals/licences/authorisations before operating the regulated activity;
- merchant onboarding/KYB and beneficial-owner processes as required;
- AML/sanctions/fraud obligations appropriate to the model;
- privacy/data-protection terms, retention and data-subject processes;
- merchant terms, prohibited-business rules, refund/dispute policies and customer support processes.

### Money movement and safeguarding

Before real funds:

- the ledger chart of accounts must be reviewed by payments/accounting specialists;
- real bank/acquirer settlement and reconciliation must be implemented;
- settlement eligibility/holds/reserves must be modelled;
- payout/bank-account verification controls must exist;
- negative balances, failed settlements and corrections must be handled;
- operational reconciliation must prove that processor, ledger and bank balances agree.

### Disputes and fraud

- disputes/chargebacks and evidence lifecycle;
- fraud/risk controls beyond the current sandbox rule engine;
- velocity/device/account abuse controls;
- review tooling and case management;
- merchant risk monitoring/reserves where applicable.

## Release labels

Use language like:

- **Sandbox** — synthetic payment data only.
- **Production-style sandbox** — externally hosted TEST platform using production operational controls.
- **Live** — only after processor, compliance, PCI and legal launch gates have actually been completed.

Never label simulated 3DS, synthetic card handling, demo settlements or the sandbox processor as certified/live.

## Current target

The engineering target of this repository is a production-grade **sandbox gateway platform** with clear seams for future regulated/live processor adapters. Real-money enablement is a separate launch programme, not a configuration switch.
