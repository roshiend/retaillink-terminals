# Security operations

This document describes operational controls for the Retaillink Terminals **sandbox/test platform**. It does not change the regulatory or PCI requirements for any future live-money service.

## Merchant account sessions

Merchant dashboard sessions use an HttpOnly cookie. Production cookies are Secure and SameSite=Lax.

Users can review active sessions from **Security** in the merchant console. The account-security API supports:

- listing active sessions;
- revoking one session;
- revoking the current session;
- logging out every active session;
- changing the password after verifying the current password.

A successful password change revokes every other active session for that user. Security-sensitive writes verify the dashboard Origin in addition to cookie authentication.

## Passwords

Passwords are stored as salted scrypt hashes. Plaintext passwords must never be logged, persisted, included in audit metadata, or copied into support tickets.

Production operations should additionally provide a controlled password-reset flow through a verified email/identity provider before external merchants rely on self-service account recovery. Do not implement password reset tokens without a configured delivery and abuse-control strategy.

## API keys

Secret API keys are generated once, returned once, and stored only as SHA-256 hashes.

Prefer **restricted API keys** instead of wildcard keys. Available sandbox scopes include:

```text
payments:read
payments:write
refunds:read
refunds:write
customers:read
customers:write
payment_links:read
payment_links:write
billing:read
billing:write
webhooks:read
webhooks:write
balance:read
settlements:read
```

Operational guidance:

- issue one key per integration/service;
- choose the minimum scopes required;
- never put secret keys in browser/mobile client code;
- rotate/revoke a key immediately after suspected disclosure;
- remove stale keys during periodic access reviews;
- review API request logs for unexpected key usage.

Legacy sandbox keys created before scopes were introduced migrate with the wildcard `*` scope for backward compatibility. For a serious external sandbox, replace wildcard integration keys with restricted keys where practical.

## Webhook signing secrets

Webhook signing secrets are separate from API keys. When `WEBHOOK_SECRET_ENCRYPTION_KEY` is configured, webhook signing secrets are AES-256-GCM encrypted before storage and transparently decrypted by the application/worker.

Production startup requires a base64-encoded 32-byte `WEBHOOK_SECRET_ENCRYPTION_KEY`. The API and Worker must receive the same key.

Key-management requirements:

- generate the key from a cryptographically secure source;
- keep it in an approved secret manager/KMS-backed configuration system;
- never put it in Git, Docker images, support tools or client-side code;
- protect backups of the key separately from database backups;
- document key ownership and recovery access;
- test restoration with an isolated database copy.

Existing plaintext webhook secrets created before encryption was enabled are not automatically re-encrypted. Rotate those endpoint secrets, or use a controlled maintenance migration, before treating the database as encrypted-at-rest at the application field level.

## Webhook destinations

Webhook endpoint creation and every retry validate the destination against SSRF rules. Production endpoint creation requires HTTPS. The background worker re-validates the destination at delivery time so DNS changes do not bypass the original check.

Keep the Worker on a private application network with no inbound public listener.

## Idempotency and financial writes

Refunds use persistent database-backed Idempotency-Key records. Production configuration requires idempotency keys for protected writes. Replaying the same key and same request returns the original response; reusing a key for different parameters returns a conflict.

Do not remove idempotency, concurrency or ledger invariants to work around merchant integration errors.

## Audit and request logs

Security and merchant-administration actions should produce audit records. API request logs intentionally contain request metadata rather than full request bodies or credentials.

Never log:

- API secret keys;
- session cookies/tokens;
- webhook signing secrets;
- complete card numbers;
- CVC/CVV;
- passwords;
- processor/acquirer private credentials.

## Dependency and container scanning

CI pins third-party GitHub Actions to immutable commit SHAs and scans the repository plus every production image for fixed HIGH/CRITICAL vulnerabilities. A finding should normally be fixed by upgrading/replacing the affected dependency or base image rather than suppressing the scanner.

Any accepted exception must be documented with the package/CVE, exploitability analysis, compensating control, owner and review/expiry date.

## Periodic access review

For an externally hosted sandbox, perform recurring reviews of:

- merchant Owners/Admins/Developers;
- active user sessions;
- wildcard and scoped API keys;
- webhook endpoints;
- deployment/CI permissions;
- database and secret-manager access;
- production support/admin access;
- stale merchant/team accounts.

## Incident response basics

If an API key is exposed:

1. revoke the key;
2. issue a new restricted key if still required;
3. inspect API logs for unexpected use;
4. review related payments/refunds/webhook changes;
5. document the incident and corrective action.

If the webhook encryption key is suspected compromised, treat every stored webhook signing secret as exposed: rotate the encryption key through a controlled re-encryption process and rotate merchant webhook signing secrets.

If the database is suspected compromised, preserve evidence, restrict access, rotate relevant secrets, review ledger/audit integrity, and follow the organisation's incident-response and breach-notification procedures.
