# TON-Bridge Worker

Cloudflare Worker backing the affiliate program (Phase 6).

## D1 database binding

The worker expects a **Cloudflare D1** database bound under the name **`DB`**.

In `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "ton-bridge-affiliate"
database_id   = "<your-d1-database-id>"
```

The binding name `DB` is the only name referenced by worker code; do not change it without updating all usages.

## Endpoints

### `POST /admin/config`

Proposes a new rate configuration. The change is persisted as an audit row in
`program_config` and becomes effective at the next full-minute boundary.

Authentication: `Authorization: Bearer <ADMIN_SECRET>`.

All request fields are optional except authentication. Unspecified fields inherit
from the current active config. Both `snake_case` and `camelCase` key names are
accepted.

```json
{
  "service_bps": 40,
  "cashback_bps": 10,
  "referral_bps": 10,
  "point_usd_value": 0.00003,
  "points_per_tbc": 10,
  "min_redeem_points": 100,
  "daily_turnover_cap_usd": 50000,
  "proposed_by": "12345678"
}
```

Successful proposals return `201` with the inserted `config_id`,
`effective_at`, and normalized config. Invalid JSON returns `400`; invalid
knob values or an unprofitable config return `422`.

### `GET /admin/api/*` (admin panel)

Endpoints backing the admin Mini App (`src/admin.njk`, issue #121). They all
share the same auth mechanism:

1. **Authentication** — the request must carry a Telegram Mini App `initData`
   payload either via `Authorization: tma <initData>`, an `?initData=` query
   parameter, or a JSON body field. Validation reuses `validateInitData()`
   (HMAC-SHA-256 against `BOT_TOKEN`). When `DEV_MODE=1` the HMAC step is
   skipped — never set this in production.
2. **Authorization** — the verified Telegram user ID must be present in
   `ADMIN_TELEGRAM_IDS` (comma-separated). An empty allow-list rejects
   everyone with `403`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/api/stats` | Turnover (24 h / 7 d / 30 d), outstanding & redeemed points, TBC payouts + USD equivalent |
| `GET` | `/admin/api/fraud-flags?page=&size=` | Paginated open + resolved flags ordered by `resolved ASC, created_at DESC` |
| `POST` | `/admin/api/fraud-flags/resolve` | Marks `{ id }` as resolved and writes an `audit_log` row |
| `GET` | `/admin/api/top-users` | Top 20 users by lifetime swap turnover in USD |
| `GET` | `/admin/api/audit-log` | Latest 50 audit rows (decoded `before` / `after` JSON) |

All responses are JSON. `401` indicates missing/invalid initData, `403`
indicates a user outside the allow-list, `404` / `409` are returned by the
resolve endpoint for missing / already-resolved flags.

## Rate-knob reference

All knobs are surfaced as environment variables with safe defaults. They are
validated on every worker boot; an invalid configuration refuses to start.

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `SERVICE_BPS` | `40` | 1 - 10000 | 0.40% house gross commission; informational because the actual commission is set by the ChangeNOW partnership |
| `CASHBACK_BPS` | `10` | 0 - 10000 | Trader rebate in basis points |
| `REFERRAL_BPS` | `10` | 0 - 10000 | Inviter rebate in basis points |
| `POINT_USD_VALUE` | `0.00003` | 1e-10 - 1 | Implied USD value per point |
| `POINTS_PER_TBC` | `10` | 1 - 1000000 | Points required to redeem 1 TBC |
| `MIN_REDEEM_POINTS` | `100` | 1 - 10000000 | Minimum redemption amount in points |
| `DAILY_TURNOVER_CAP_USD` | `50000` | 1 - 1000000000 | Maximum daily swap turnover that earns points per user |

### Internal Consistency

`cashback_bps + referral_bps <= service_bps`

This ensures the program cannot pay more rebates than the configured service
commission. Violating it causes worker boot validation to fail or
`POST /admin/config` to return `422`.

### Worst-case Impact

| Scenario | Impact |
|----------|--------|
| Increase `CASHBACK_BPS` from 10 to 20 | Trader rebate doubles; house margin drops from 0.20% to 0.10% of turnover |
| Set `REFERRAL_BPS` to 0 | Referral rewards stop; house keeps 0.30% at default service/cashback rates |
| Increase `DAILY_TURNOVER_CAP_USD` | Heavy traders can earn more; fraud exposure rises proportionally |
| Decrease `MIN_REDEEM_POINTS` | Smaller redemptions become possible; payout volume and gas cost can rise |

## Historical Immutability

Every `point_ledger` row carries a `config_id` foreign key that references the
`program_config` row active when the row was written. Auditors can reproduce the
exact point calculation for any swap by joining `point_ledger` to
`program_config`, even after rates change.

`program_config` is append-only; rows are never updated or deleted.

## Migrations

Migrations live in `worker/migrations/` and are applied in filename order.

| File | Description |
|------|-------------|
| `0001_affiliate.sql` | Core affiliate tables: `users`, `swaps`, `point_ledger`, `redemptions`; `user_balances` view |
| `0002_accrual_cursor.sql` | Accrual cursor state |
| `0003_program_config.sql` | Versioned rate config table and `point_ledger.config_id` reference |
| `0004_admin_tables.sql` | `fraud_flags` and `audit_log` tables backing the admin panel (issue #121) |

Apply locally with Wrangler:

```bash
npx wrangler d1 execute ton-bridge-affiliate --local --file worker/migrations/0001_affiliate.sql
npx wrangler d1 execute ton-bridge-affiliate --local --file worker/migrations/0002_accrual_cursor.sql
npx wrangler d1 execute ton-bridge-affiliate --local --file worker/migrations/0003_program_config.sql
npx wrangler d1 execute ton-bridge-affiliate --local --file worker/migrations/0004_admin_tables.sql
```

Apply to production:

```bash
npx wrangler d1 execute ton-bridge-affiliate --file worker/migrations/0001_affiliate.sql
npx wrangler d1 execute ton-bridge-affiliate --file worker/migrations/0002_accrual_cursor.sql
npx wrangler d1 execute ton-bridge-affiliate --file worker/migrations/0003_program_config.sql
npx wrangler d1 execute ton-bridge-affiliate --file worker/migrations/0004_admin_tables.sql
```

## Environment Variables And Secrets

| Name | How to set | Required |
|------|------------|----------|
| `BOT_TOKEN` | `wrangler secret put BOT_TOKEN` | Yes |
| `JWT_SECRET` | `wrangler secret put JWT_SECRET` | Yes |
| `CHANGENOW_API_KEY` | `wrangler secret put CHANGENOW_API_KEY` | Yes |
| `LEADERBOARD_CHANNEL_ID` | `wrangler secret put LEADERBOARD_CHANNEL_ID` | Yes |
| `ADMIN_SECRET` | `wrangler secret put ADMIN_SECRET` | Yes for admin endpoints |
| `TONBANKCARD_API_KEY` | `wrangler secret put TONBANKCARD_API_KEY` | Yes for live payouts |
| `ADMIN_TELEGRAM_IDS` | `wrangler secret put ADMIN_TELEGRAM_IDS` (comma-separated Telegram user IDs) | Yes for admin panel |
| `DEV_MODE` | `wrangler.toml [vars]` (`"1"` enables) | No; bypasses initData HMAC for local tests only |
| Rate knobs | `wrangler.toml [vars]` | No; defaults are shown above |

## Tests

Tests load migrations into an in-memory SQLite database and exercise the worker
helpers with Node's built-in test runner:

```bash
npm run test:schema
npm run test:rate-config
npm run test:admin-panel
```
