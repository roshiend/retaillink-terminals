# Security Policy

## Sandbox-only project

Retaillink Terminals is currently a developer sandbox and payment-gateway simulator.

Do not use it to process real money or submit real card details.

## Never submit sensitive payment data

Do not place any of the following in issues, pull requests, screenshots, logs, test fixtures, commits or webhook examples:

- real card PANs
- CVC/CVV values
- magnetic-stripe/track data
- real online-banking credentials
- production merchant/acquirer credentials
- live API keys
- private signing keys

Use only documented synthetic sandbox values.

## Secret handling

Sandbox `sk_test_...` and `whsec_test_...` values should still be treated as secrets for the environment in which they are used.

Do not commit local `.env` files or generated secret values.

## Reporting a vulnerability

Do not publish a security vulnerability containing exploitable details in a normal public issue.

If GitHub private vulnerability reporting / Security Advisories are enabled for this repository, use that private channel. Otherwise contact the repository owner privately before publishing technical exploit details.

Include:

- affected component
- reproduction steps using synthetic/sandbox data only
- impact
- proposed mitigation if known

## Security-sensitive invariants

Changes should preserve these rules:

- CVC/CVV is never stored.
- Arbitrary real card numbers are not accepted as a live payment method.
- secret API keys are not persisted in plaintext.
- merchant data is scoped by merchant ownership.
- session-authenticated writes are protected by role and allowed-origin checks.
- refunds cannot exceed the refundable payment balance.
- ledger history is append-only.
- webhook targets are checked against private/reserved networks before delivery and retry.
- webhook signatures are generated from the exact payload body and timestamp.
- idempotency prevents duplicate logical payment creation.

## Production boundary

Before any real-money deployment, the system requires a separate production security programme including processor/acquirer architecture, PCI DSS scope determination, secrets management, independent penetration testing, operational monitoring, incident response, fraud controls and the required Sri Lankan regulatory/legal approvals.
