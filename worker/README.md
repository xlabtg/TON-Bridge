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

## Rate limits

- At most **1 in-flight** redemption per user (status = `requested`).
- At most **5 redemptions per calendar day** per user.

## TONBANKCARD API

The worker calls `POST https://api.tonbankcard.com/v1/credit` with:
```json
{
  "recipient_address": "<ton_address>",
  "tbc_amount": 10,
  "external_ref": "redemption_42_user_123456"
}
```
Authorization: `Bearer $TONBANKCARD_API_KEY` (set as a Cloudflare Worker secret).

On success the redemption row is flipped to `paid`. On any non-2xx response or network error the row is flipped to `failed` and a compensating positive-delta `point_ledger` row is inserted to restore the user's balance.

## Environment variables / secrets

| Name                   | How to set                          | Required |
|------------------------|-------------------------------------|----------|
| `TELEGRAM_BOT_TOKEN`   | `wrangler secret put TELEGRAM_BOT_TOKEN` | Yes      |
| `TONBANKCARD_API_KEY`  | `wrangler secret put TONBANKCARD_API_KEY` | Yes (for live payouts) |
| `DEV_MODE`             | `wrangler.toml [vars]`              | No (default `false`) |

## Setup

```bash
# Install dependencies
npm install

# Create D1 database
wrangler d1 create ton-bridge-affiliate

# Copy the returned database_id into wrangler.toml

# Run migration
wrangler d1 execute ton-bridge-affiliate --file=migrations/0001_affiliate.sql

# Set secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TONBANKCARD_API_KEY

# Deploy
npm run deploy
```

## Tests

```bash
npm test
```
