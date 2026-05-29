# Application Logic Audit (Issue #180)

Date: 2026-05-29

Scope: end-to-end review of the whole application logic requested in
[#180](https://github.com/xlabtg/TON-Bridge/issues/180) — verifying that the
work done across the closed issues/PRs is correct and coherent both
system-wise and for the end user. This pass re-checks the earlier audits
(`APPLICATION_AUDIT.md` 2026-05-04, `AUDIT.md` 2026-05-19) and the fixes
shipped since (#152 → #179), runs the full verification matrix, fixes the
concrete defects found, and catalogues the remaining follow-ups with their
severity.

Every claim below was verified against the code; speculative findings that did
**not** hold up under inspection are explicitly listed in "Checked and found
correct" so they are not re-investigated later.

## Verification Matrix

| Check | Result | Notes |
| --- | --- | --- |
| `npm ci` | Passed | Clean install on Node 20.20.2. |
| `npm run check:i18n` | Passed | EN/RU key parity intact (incl. the new `offline_indicator` key). |
| `npm run build` | Passed | Requires the documented `.env`; 25 pages + service worker emitted. |
| `npx html-validate "dist/*.html"` | Passed (0 errors) | `void-content` warnings for `</br>` dropped from **18 → 0** after this PR. |
| `npm run test:unit` | Passed | 18/18 (`usdOracle`, `swapsWriter`). |
| `npm run test:auth-verify` | Passed | 10/10 Telegram initData verification. |
| `npm run test:accrual` | Passed | 30/30 points accrual. |
| `npm run test:redeem` | Passed | 10/10 redemption logic. |
| `npm run test:rate-config` | Passed | 27/27. |
| `npm run test:schema` | Passed | 8/8 affiliate schema. |
| `npm run test:admin-panel` | Passed | 26/26. |
| `npm run test:referral-rewards` | Passed | 4/4. |
| `npm run test:installer` (PHP) | Passed | Installer + `deployment-assets.test.php` (root-file drift guard). |
| Targeted Playwright specs | Passed | 30/30 across page-cleanup, switch-inline-query, layout-regression, about-app, and the new #180 spec. |

## Fixed in This PR

### 1. Invalid `</br>` markup on the main / exchange / steps pages (completes #178)

`</br>` is a closing tag for a void element. Browsers parse it as an *extra*
`<br>`, so it injected an unintended line break — exactly the "too much
indentation … as if there is some unnecessary code there" complaint from
[#178](https://github.com/xlabtg/TON-Bridge/issues/178). PR #179 only removed
it from the OTC template; the same stray tag remained in:

* `src/_includes/widget-page.njk:228` (Bridge **and** Exchange shells — `index*`, `index2*`)
* `src/_includes/steps-page.njk:123` (intro steps — `1.html`, `2.html`)

`html-validate` flagged these as 18 `void-content` warnings across the built
pages; the count is now 0.

### 2. Offline indicator was hard-coded English in every shell (relates to #172)

The `#offline-indicator` banner ("You are offline") shipped as static English
in six shells (`intro`, `orders`, `otc`, `settings`, `steps`, `widget`) with no
`data-i18n` hook, so Russian users saw English even after the language was
applied. Added `data-i18n="offline_indicator"` to all six and the
`offline_indicator` key to both `src/i18n/en.json` and `src/i18n/ru.json`
("Нет подключения к интернету"). `assets/js/i18n.js` already translates
`data-i18n` nodes, so no JS change was needed.

### 3. Re-synced the committed root HTML — the installer's actual payload

This is the systemic root cause behind the recurring "fixes don't reach the
deployed app" reports (#166, #174, #176). The build writes to `dist/` (which is
git-ignored); the PHP installer instead patches the **committed root `*.html`
files**, so any `src/` fix that is not regenerated into the root files never
ships. The 23 tracked root pages were stale (older `?v=1cc53a7` OG cache-buster,
missing the two fixes above). They were regenerated from `src/` via
`BUILD_SHA=1cc53a7 npm run build` and trailing-whitespace-trimmed to match the
existing convention (commit 8c7e5d1), keeping the diff to the genuine content
changes only. `tests/deployment-assets.test.php` continues to guard against
future drift. The admin-panel CSP `connect-src … workers.dev` rule from #174 was
verified intact after the re-sync.

### 4. Regression test

`tests/issue-180-logic-audit.spec.js` asserts that (a) no built page contains
`</br>`, (b) every rendered offline indicator carries `data-i18n="offline_indicator"`,
and (c) the key exists in both locales and the RU value is not an English copy.

## Checked and Found Correct (no change needed)

These were investigated — several flagged as suspicious during the sweep — and
confirmed to be working as intended:

* **Telegram `initData` HMAC validation** (`worker/src/validateInitData.js:18-33`)
  is the correct spec: `secret = HMAC("WebAppData", botToken)` then
  `hash = HMAC(secret, dataCheckString)`. No auth bypass.
* **Preference persistence across devices** (`assets/js/prefs.js:127-178`) reads
  CloudStorage first and falls back to `localStorage`; `set()` writes through to
  CloudStorage and clears the local copy on success. Cloud-first ordering is
  correct (addresses the #166 "not remembered per user" concern).
* **Bottom navigation is unified** to the 8-item shape across all shells via
  `src/_includes/bottom-nav.njk` (closes the #118 inconsistency).
* **"About the app" block** (`src/_includes/settings-page.njk`) shows the
  marketing copy required by #168 and keeps only the admin-only login link.
* **"Send to chat" button** hides correctly when `switchInlineQuery` is
  unavailable or outside Telegram (#178) — verified by `switch-inline-query.spec.js`.
* **Referral capture** (`worker/src/auth-verify.js`) enforces all five rules
  (format, no self-refer, capture-once, no 1-cycle, no cycle ≤ depth 5) inside a
  transaction; `ref_code` matching is consistently upper-case `[A-Z0-9]{8}`.
* **Left-side menu scroll jump** (#170) — the page-scroll-lock fix (commit
  b7d8732) is present.

## Residual Findings / Recommended Follow-ups

Ordered by severity. None are regressions from this PR; they are pre-existing.
Per the request in #181, each open follow-up has now been filed as a dedicated
tracking issue (linked below).

| # | Severity | Area | Finding | Tracking issue / action |
| --- | --- | --- | --- | --- |
| R1 | Medium | `worker/leaderboard.js:285-326` | The `/optin` endpoint only checks that the `X-Telegram-Init-Data` header is *present* (documented as such on line 282-283); it never verifies the HMAC nor that the posted `userId` matches the signed user. Any caller can opt any `userId` in/out of the leaderboard. | [#182](https://github.com/xlabtg/TON-Bridge/issues/182) — validate `initData` with `validateInitData()` and derive `userId` from the signed `user`, ignoring the body. |
| R2 | Low | `worker/src/adminConfig.js` | `handleAdminConfig()` is exported but never imported/mounted in `worker/src/index.js`, so the runtime rate-knob update path (#55) is unreachable dead code. | [#183](https://github.com/xlabtg/TON-Bridge/issues/183) — mount the route behind the existing admin gate, or remove it. |
| R3 | Low | `worker/src/accrualJob.js`, `redeemHandler.js`, `index.js`, `auth-verify.js` | `point_ledger.config_id` (added in migration `0003`) is never populated on insert, so ledger rows cannot be tied back to the rate config in effect. Not a bug (column is nullable) but weakens the audit trail. | [#184](https://github.com/xlabtg/TON-Bridge/issues/184) — populate `config_id` from the active config when writing ledger rows. |
| R4 | Low | `src/_includes/*-page.njk` (CSP) | CSP is enforced via `<meta>` but still relies on `'unsafe-inline'` for scripts/styles; `report-uri`/`frame-ancestors` are omitted (ignored in meta). Carried over from #117. | [#185](https://github.com/xlabtg/TON-Bridge/issues/185) — move CSP to HTTP headers, migrate inline blocks to nonces/hashes, and drop the now-unused `cdn.jsdelivr.net` allowance. |
| R5 | Resolved | `src/_includes/statistics-page.njk` | Earlier audits flagged Chart.js as loaded from a CDN without SRI (#119). **Re-verified: this is already fixed** — Chart.js is self-hosted at `assets/js/lib/chart.umd.min.js` (same-origin, so SRI does not apply) and #119 is closed. The only remnant is a stale `cdn.jsdelivr.net` entry in some CSP `<meta>` tags, folded into R4 ([#185](https://github.com/xlabtg/TON-Bridge/issues/185)). | No standalone issue (resolved). |
| R6 | Low | `src/_includes/admin-page.njk` + worker | Admin panel surface is gated by Telegram IDs but production data flows depend on the worker APIs being deployed (#121). | [#186](https://github.com/xlabtg/TON-Bridge/issues/186) — confirm the deployed worker backs every admin view with authorized endpoints. |
| R7 | Polish | Bridge / Exchange / OTC | Render-blocking CSS/JS and a legacy-JS warning persist (#122); Lighthouse budgets still pass. | [#187](https://github.com/xlabtg/TON-Bridge/issues/187) — performance follow-up. |

## Notes for Reviewers

* The only behaviour-affecting source edits are the two markup/localization
  fixes; everything else in the diff is the deterministic root-HTML re-sync
  (so the fixes actually reach installer deployments) plus the new test.
* The root-HTML re-sync is reproducible: `BUILD_SHA=1cc53a7 npm run build`
  followed by trailing-whitespace trimming yields the committed files.
