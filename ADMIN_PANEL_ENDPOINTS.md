# Admin Panel — view ↔ endpoint contract (issue #186)

Date: 2026-05-29

The admin Mini App (`src/_includes/admin-page.njk`, rendered to `admin/index.html`
via `src/admin.njk`, driven by `assets/js/admin.js`) shows **no inline demo data**:
every view is populated purely from authenticated calls to the Cloudflare Worker
(`worker/src/adminPanel.js`, mounted in `worker/src/index.js`). This is the
demo-data → server-API migration from [#121](https://github.com/xlabtg/TON-Bridge/issues/121).

The risk flagged as **R6** in `LOGIC_AUDIT.md` is operational: if a view's backing
endpoint is ever dropped from the deployed worker — or shipped without the admin
auth gate — that panel would silently fall back to empty/placeholder data in
production. This document is the positive confirmation that each view is backed by
an authorised, deployed worker endpoint, and the automated smoke check that keeps
it from regressing.

## View → endpoint matrix

Every panel view below is rendered from the listed endpoint. All endpoints are
served by `handleAdminPanelRequest()` and pass through `requireAdmin()`
(Telegram `initData` HMAC authentication + `ADMIN_TELEGRAM_IDS` allow-list
authorization) before returning any data.

| Admin panel view (`admin-page.njk`) | Client call (`admin.js`) | Worker endpoint | Authorised |
|---|---|---|---|
| Platform Turnover (24 h / 7 d / 30 d) | `loadStats()` | `GET /admin/api/stats` | ✅ `requireAdmin` |
| Users (total / new 24 h / new 7 d) | `loadStats()` | `GET /admin/api/stats` | ✅ `requireAdmin` |
| Points (outstanding / redeemed) | `loadStats()` | `GET /admin/api/stats` | ✅ `requireAdmin` |
| TBC Paid Out (count / total / USD) | `loadStats()` | `GET /admin/api/stats` | ✅ `requireAdmin` |
| Fraud Flags (paginated table) | `loadFraud()` | `GET /admin/api/fraud-flags` | ✅ `requireAdmin` |
| Fraud Flags — Resolve action | `resolveFlag()` | `POST /admin/api/fraud-flags/resolve` | ✅ `requireAdmin` |
| Top Users by Lifetime Turnover | `loadTopUsers()` | `GET /admin/api/top-users` | ✅ `requireAdmin` |
| Recent Users | `loadUsers()` | `GET /admin/api/users` | ✅ `requireAdmin` |
| Audit Log | `loadAuditLog()` | `GET /admin/api/audit-log` | ✅ `requireAdmin` |

The endpoint list is **not hand-maintained against drift**: the smoke check
extracts every `apiGet(…)` / `apiPost(…)` call straight from the shipping
`assets/js/admin.js` and asserts it against this matrix, so adding a client call
without a backing endpoint (or vice versa) fails CI.

## Automated smoke check

`worker/tests/adminPanelContract.test.js` (run via `npm run test:admin-contract`,
wired into CI as the **Admin Panel Contract Tests** job) verifies, for every view
above:

1. **Enumeration** — the set of `/admin/api/*` endpoints the client calls equals
   the documented matrix (no orphan calls, no orphan endpoints).
2. **Backed** — each endpoint is routed by `handleAdminPanelRequest()` (it does
   not fall through to a 404), so the deployed worker answers it.
3. **Authorised** — each endpoint returns `401` for missing `initData`, `403`
   for a non-allow-listed user, and lets an allow-listed admin past the gate.
4. **Mounted** — `worker/src/index.js` imports `handleAdminPanelRequest` and
   dispatches the `/admin/api/` prefix to it (not dead, unmounted code).
5. **Reachable from the browser** — the admin page CSP `connect-src` allows the
   worker origin the client defaults to (`DEFAULT_API_BASE` in `admin.js`).

The check runs entirely in-process against the real migration SQL (better-sqlite3
D1 substitute) — no Cloudflare deployment needed.

## Manual verification on deploy

The automated check proves the *code* contract. To confirm the *deployment* is
configured (worker reachable, secrets set), run this once per environment after a
deploy. Replace the host with your worker URL (the production default is
`https://ton-bridge-worker.tonbankcard.workers.dev`) and `<initData>` with a real
Telegram Mini App payload from an allow-listed admin account.

```sh
WORKER="https://ton-bridge-worker.tonbankcard.workers.dev"
INIT="<initData from an allow-listed admin>"

for ep in \
  "GET /admin/api/stats" \
  "GET /admin/api/fraud-flags" \
  "GET /admin/api/top-users" \
  "GET /admin/api/users" \
  "GET /admin/api/audit-log"
do
  m=${ep% *}; p=${ep#* }
  code=$(curl -s -o /dev/null -w '%{http_code}' -X "$m" \
    -H "Authorization: tma $INIT" "$WORKER$p")
  echo "$ep -> $code"   # expect 200
done

# Negative control: no initData must be rejected, not served empty data.
curl -s -o /dev/null -w 'no-auth /admin/api/stats -> %{http_code}\n' "$WORKER/admin/api/stats"
# expect 401
```

A `200` for every authenticated call (and `401` for the negative control)
confirms the deployed worker backs each admin view with an authorised endpoint.
A `404`/`403`/`401` on an authenticated call means the worker is not deployed,
`ADMIN_TELEGRAM_IDS` is unset/empty, or `BOT_TOKEN` is misconfigured — fix the
deployment before relying on the panel.

## Required deployment configuration

| Variable | How it is set | Needed for |
|---|---|---|
| `BOT_TOKEN` | `wrangler secret put BOT_TOKEN` | `initData` HMAC validation |
| `ADMIN_TELEGRAM_IDS` | `wrangler secret put ADMIN_TELEGRAM_IDS` (comma-separated) | allow-list authorization |
| `POINTS_PER_TBC`, `POINT_USD_VALUE` | `worker/wrangler.toml [vars]` | stats USD equivalent |
| `ADMIN_API_BASE` (build-time) | `.env` → `<meta name="admin-api-base">` | client points at the deployed worker |
| `ADMIN_TELEGRAM_IDS` (build-time) | `.env` → `<meta name="admin-ids">` | client-side fast-path allow-list |
