# TON-Bridge Worker

Cloudflare Worker backing the affiliate program (Phase 6).

## D1 database binding

The worker expects a **Cloudflare D1** database bound under the name **`DB`**.

In `wrangler.toml` (to be created in issue #6.2):

```toml
[[d1_databases]]
binding = "DB"
database_name = "ton-bridge-affiliate"
database_id   = "<your-d1-database-id>"
```

The binding name `DB` is the only name referenced by worker code — do not change it without updating all usages.

## Migrations

Migrations live in `worker/migrations/` and are applied in filename order.

| File | Description |
|------|-------------|
| `0001_affiliate.sql` | Core affiliate tables: `users`, `swaps`, `point_ledger`, `redemptions`; `user_balances` view |

Apply locally with Wrangler:

```bash
npx wrangler d1 execute ton-bridge-affiliate --local --file worker/migrations/0001_affiliate.sql
```

Apply to production:

```bash
npx wrangler d1 execute ton-bridge-affiliate --file worker/migrations/0001_affiliate.sql
```

## Schema smoke tests

Tests load each migration into an in-memory SQLite database (via `better-sqlite3`) and verify schema correctness and balance computation:

```bash
npm run test:schema
```
