# TON Bridge Worker

Cloudflare Worker backend for the Phase 6 affiliate program.

## Endpoints

### `GET /api/balance?initData=<encoded>`

Returns the authenticated user's current points balance, TON address, and last 20 redemptions.

**Response:**
```json
{
  "points": 350,
  "ton_address": "EQA...",
  "redemptions": [
    {
      "id": 1,
      "points_spent": 100,
      "tbc_amount": 10,
      "status": "paid",
      "created_at": "2024-01-15T12:00:00"
    }
  ]
}
```

### `POST /api/redeem`

Redeem points for TBC.

**Request body:**
```json
{
  "points_spent": 100,
  "initData": "<Telegram.WebApp.initData>"
}
```

**Success response (200 — paid immediately):**
```json
{ "ok": true, "queued": false, "tbc_amount": 10, "redemption_id": 42 }
```

**Success response (201 — queued, no wallet linked):**
```json
{ "ok": true, "queued": true, "tbc_amount": 10, "redemption_id": 43 }
```

**Error responses:**

| `error` code    | HTTP | Meaning                                    |
|-----------------|------|--------------------------------------------|
| `unauthorized`  | 401  | Invalid or missing initData                |
| `min_points`    | 400  | `points_spent` < 100                       |
| `not_multiple`  | 400  | `points_spent` is not a multiple of 10     |
| `low_balance`   | 400  | Insufficient points                        |
| `in_flight`     | 429  | Already has a pending redemption           |
| `rate_limit`    | 429  | ≥ 5 redemptions today                      |
| `payout_failed` | 502  | TONBANKCARD API call failed (rolled back)  |

### `POST /admin/config` *(rate-knob configuration — issue #55)*

Propose a new rate configuration. The change is persisted as an audit row in
`program_config` and becomes **effective at the next full-minute boundary**,
ensuring a clean transition between rate epochs.

Authentication: `Authorization: Bearer <ADMIN_SECRET>`.

**Request body** (all fields optional — unspecified fields inherit from the current active config):

```json
{
  "service_bps":            40,
  "cashback_bps":           10,
  "referral_bps":           10,
  "point_usd_value":        0.00003,
  "points_per_tbc":         10,
  "min_redeem_points":      100,
  "daily_turnover_cap_usd": 50000,
  "proposed_by":            "12345678"
}
```

Both `snake_case` and `camelCase` key names are accepted.

**Success response (201):**
```json
{
  "ok": true,
  "config_id": 7,
  "effective_at": 1700000100,
  "effective_at_iso": "2023-11-14T22:35:00.000Z",
  "config": {
    "serviceBps": 40,
    "cashbackBps": 10,
    "referralBps": 10,
    "pointUsdValue": 0.00003,
    "pointsPerTbc": 10,
    "minRedeemPoints": 100,
    "dailyTurnoverCapUsd": 50000
  }
}
```

**Error responses:**

| `error` code        | HTTP | Meaning                                        |
|---------------------|------|------------------------------------------------|
| `unauthorized`      | 401  | Missing or wrong `ADMIN_SECRET` bearer token   |
| `bad_request`       | 400  | Request body is not valid JSON                 |
| `validation_failed` | 422  | A knob is out of range or house would lose money |

## Rate-knob reference

All knobs are surfaced as environment variables with safe defaults. They are
validated on every worker boot; an invalid configuration refuses to start.

| Variable                 | Default    | Range                 | Description                                             |
|--------------------------|------------|-----------------------|---------------------------------------------------------|
| `SERVICE_BPS`            | `40`       | 1 – 10 000           | 0.40 % — house gross commission (informational only; actual is set by the ChangeNOW partnership) |
| `CASHBACK_BPS`           | `10`       | 0 – 10 000           | Trader rebate in basis points (0.10 %)                  |
| `REFERRAL_BPS`           | `10`       | 0 – 10 000           | Inviter rebate in basis points (0.10 %)                 |
| `POINT_USD_VALUE`        | `0.00003`  | 1e-10 – 1            | Implied $/point — determines how many points a dollar of turnover earns |
| `POINTS_PER_TBC`         | `10`       | 1 – 1 000 000        | Points required to redeem 1 TBC token                   |
| `MIN_REDEEM_POINTS`      | `100`      | 1 – 10 000 000       | Minimum redemption amount in points (= 10 TBC)          |
| `DAILY_TURNOVER_CAP_USD` | `50000`    | 1 – 1 000 000 000    | Anti-fraud: maximum daily swap turnover that earns points per user |

### Internal consistency constraint

`cashback_bps + referral_bps ≤ service_bps`

This ensures the house retains at least some margin. Violating it causes the
worker to refuse to start (or the `POST /admin/config` endpoint to return 422).

**At the recommended 0.10 % / 0.10 % split:**

> Every $1 of swap turnover ≈ 33 points ≈ 3.3 TBC ≈ $0.001 cashback.

See `IMPROVEMENTS.md §6.0` for the full economic model and worked examples.

### Worst-case impact examples

| Scenario                                | Impact                                        |
|-----------------------------------------|-----------------------------------------------|
| Increase `CASHBACK_BPS` from 10 → 20   | Trader rebate doubles; house margin drops from 0.20 % → 0.10 % of turnover |
| Set `REFERRAL_BPS` to 0                 | Referral program disabled; house keeps 0.30 % |
| Increase `DAILY_TURNOVER_CAP_USD`       | Heavier traders earn more; fraud risk rises proportionally |
| Decrease `MIN_REDEEM_POINTS`            | Smaller redemptions allowed; more on-chain transactions and gas cost |

## Historical immutability

Every `point_ledger` row carries a `config_id` foreign key that references the
`program_config` row that was active when it was written. This means:

- **A user looking at ledger rows from January sees the rates that were in
  effect in January**, even if the rates have since changed.
- Auditors can reproduce the exact point calculation for any swap by joining
  `point_ledger → program_config`.
- The `program_config` table is append-only; rows are never updated or deleted.

## Rate limits

- At most **1 in-flight** redemption per user (status = `requested`).
- At most **5 redemptions per calendar day** per user.

## Environment variables / secrets

| Name                     | How to set                                        | Required |
|--------------------------|---------------------------------------------------|----------|
| `TELEGRAM_BOT_TOKEN`     | `wrangler secret put TELEGRAM_BOT_TOKEN`          | Yes      |
| `TONBANKCARD_API_KEY`    | `wrangler secret put TONBANKCARD_API_KEY`         | Yes (for live payouts) |
| `CHANGENOW_API_KEY`      | `wrangler secret put CHANGENOW_API_KEY`           | Yes (accrual job) |
| `ADMIN_SECRET`           | `wrangler secret put ADMIN_SECRET`                | Yes (admin endpoints) |
| `SERVICE_BPS`            | `wrangler.toml [vars]`                            | No (default `40`) |
| `CASHBACK_BPS`           | `wrangler.toml [vars]`                            | No (default `10`) |
| `REFERRAL_BPS`           | `wrangler.toml [vars]`                            | No (default `10`) |
| `POINT_USD_VALUE`        | `wrangler.toml [vars]`                            | No (default `0.00003`) |
| `POINTS_PER_TBC`         | `wrangler.toml [vars]`                            | No (default `10`) |
| `MIN_REDEEM_POINTS`      | `wrangler.toml [vars]`                            | No (default `100`) |
| `DAILY_TURNOVER_CAP_USD` | `wrangler.toml [vars]`                            | No (default `50000`) |
| `DEV_MODE`               | `wrangler.toml [vars]`                            | No (default `false`) |

## Setup

```bash
# Install dependencies
npm install

# Create D1 database
wrangler d1 create ton-bridge-affiliate

# Copy the returned database_id into wrangler.toml

# Run migrations (in order)
wrangler d1 execute ton-bridge-affiliate --file=migrations/0001_affiliate.sql
wrangler d1 execute ton-bridge-affiliate --file=migrations/0002_accrual_cursor.sql
wrangler d1 execute ton-bridge-affiliate --file=migrations/0003_program_config.sql

# Set secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TONBANKCARD_API_KEY
wrangler secret put CHANGENOW_API_KEY
wrangler secret put ADMIN_SECRET

# Deploy
npm run deploy
```

## Tests

```bash
# From the repo root:
npm run test:rate-config    # rate-knob validation + admin endpoint unit tests
npm run test:schema         # affiliate schema smoke tests
npm run test:accrual        # accrual job unit tests
```
