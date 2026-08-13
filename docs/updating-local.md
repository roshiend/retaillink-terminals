# Updating an existing local Retaillink Terminals checkout

The repository now keeps Prisma migrations under version control. Existing development databases should apply the committed migrations rather than create new migrations for code pulled from GitHub.

From WSL:

```bash
cd /mnt/d/cardmachine/retaillink-terminals

git pull
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm dev
```

`pnpm db:deploy` runs `prisma migrate deploy` and applies migrations that are present in the repository but not yet recorded in your local database.

## Check migration state

```bash
pnpm --filter @retaillink/database exec prisma migrate status
```

## Do not use this for normal pulls

```bash
pnpm db:migrate --name update
```

`prisma migrate dev` is for creating a new migration when you intentionally change the Prisma schema during development. It should not be used merely because you pulled code that already contains its migration.

## PostgreSQL

Make sure the local database is running first:

```bash
docker compose up -d postgres
docker compose ps
```

## Environment

The database environment file remains:

```text
packages/database/.env
```

with a local development URL similar to:

```env
DATABASE_URL="postgresql://retaillink:retaillink_dev@localhost:5432/retaillink_terminal?schema=public"
```
