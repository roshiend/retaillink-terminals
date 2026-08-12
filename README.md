# Retaillink Terminals

Sandbox-first payment gateway and merchant payment platform.

## Current goal

Build a safe demo environment that behaves like a modern payment gateway without processing or storing real card data.

## Initial architecture

- `apps/api` — payment gateway API
- `apps/dashboard` — merchant dashboard (next milestone)
- `apps/checkout` — hosted checkout (next milestone)
- `packages/database` — Prisma schema and database client
- `packages/payment-core` — payment processing abstractions
- `packages/ledger` — double-entry ledger (later milestone)
- `packages/shared` — shared types/utilities

## Development stack

- TypeScript
- Fastify
- PostgreSQL
- Prisma
- pnpm workspaces
- Docker Compose

> This repository is currently a sandbox/demo only. Do not use real card numbers or real payment credentials.
