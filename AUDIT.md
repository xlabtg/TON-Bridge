# Full In-Depth Audit (Issue #115)

Date: 2026-05-19
Scope: Second-pass review of all work completed against the improvements plan
(issue #1) and the 53-task roadmap (issue #2), revisiting earlier audit output
(`APPLICATION_AUDIT.md`, PR #114). The goal of this pass was to verify the
implementation end-to-end, fix shortcomings and visual bugs uncovered along
the way, and surface professional follow-up work as new GitHub issues.

This document only catalogues findings that are **new since
`APPLICATION_AUDIT.md`** (dated 2026-05-04). The residual items already noted
there remain valid and are referenced where relevant.

## Verification Matrix

| Check | Result | Notes |
| --- | --- | --- |
| `npm run build` | Passed | Requires the documented `.env` (`TG_ANALYTICS_TOKEN`, `TG_ANALYTICS_APP_NAME`, `YANDEX_METRIKA_ID`, `CHANGENOW_LINK_ID`, `BOT_USERNAME`). |
| `npm run check:i18n` | Passed | EN/RU translation key parity intact. |
| `npm run validate:manifest` | Passed | Web manifest validates. |
| `npm run test:unit` | Passed | 18/18. |
| `npm run test:schema` | Passed | Affiliate schema. |
| `npm run test:auth-verify` | Passed | Telegram auth verification. |
| `npm run test:accrual` | Passed | Points accrual. |
| `npm run test:redeem` | Passed | Redeem business logic. |
| `npm run test:rate-config` | Passed | Rate configuration. |
| `npm run test:installer` | Passed | Installer configuration. |
| `npx playwright test` | Passed | 516 Playwright tests. |
| `npx html-validate "dist/*.html"` | Passed | Top-level pages validate. |

## Fixed in This PR

### 1. CloudStorage crashes the app on Telegram WebApp 6.0

`Telegram.WebApp.CloudStorage` exists as an object even on clients that don't
support it (Telegram WebApp < 6.1). On those clients its methods throw
`WebAppMethodUnsupported` **synchronously**, which silently corrupted three
flows that wrapped the call in a Promise/callback without `try`/`catch`:

* `assets/js/prefs.js` — `migrate()` never resolved, so `prefs.init()` hung
  forever and every consumer (`pref:lang`, `pref:theme`, `pref:lastPair`,
  `pref:notificationsOptOut`) waited indefinitely.
* `assets/js/achievements.js` — `loadStats()` / `saveStats()` threw and broke
  the tier badge + celebration modal.
* `assets/js/address-book.js` — `loadEntries()` / `saveEntries()` threw and
  broke the chip list and Manage Addresses page.

Fix: gate `CloudStorage` access behind `tg.isVersionAtLeast('6.1')` and wrap
all calls in `try`/`catch` so unsupported clients fall back to `localStorage`
(the existing fallback path that was already there for non-Telegram envs).

### 2. CSP delivered via `<meta>` is silently ignored

All 12 `src/_includes/*-page.njk` shells declare CSP as:

```html
<meta http-equiv="Content-Security-Policy-Report-Only" content="…">
```

Per the W3C CSP3 spec and the MDN reference, only `Content-Security-Policy`
is honoured inside `<meta>`. The `Report-Only` variant is **not supported in
meta** — browsers drop it. That meant the report-only policy the project has
been shipping was a no-op end to end, with no console violations, no reports,
and no protection.

Status: this PR documents the finding. The fix needs to either (a) switch the
meta tag to enforced mode after rigorously enumerating every origin the app
talks to, or (b) move CSP to HTTP response headers via Cloudflare Worker /
GitHub Pages `_headers`. Doing either inside this audit PR carries real
regression risk and is filed as a follow-up issue (see "New Follow-Up
Issues" below).

## Audit Findings Without Code Changes Here

These are real issues but the right fix is product/UX scoped and belongs in
its own PR/issue, not in an audit branch. All of them are filed as
follow-ups.

### A. Bottom navigation inconsistency across pages

The bottom app menu has **two different shapes** in the codebase:

* 5 items — Bridge, Exchange, OTC, Orders, Settings — on
  `orders-page.njk`, `redeem-page.njk`, `referral-page.njk`,
  `statistics-page.njk`, and several other shells.
* 8 items — Bridge, Exchange, OTC, Orders, Redeem, Statistics, Referral,
  Settings — on `widget-page.njk` (the main Bridge / Exchange / OTC shells).

Users navigating from a Bridge page (8-tab nav) into Orders (5-tab nav) lose
access to Redeem / Statistics / Referral and have to bounce through Bridge to
get back. The right fix is a product decision about which items belong in the
primary nav versus a secondary menu, so this is filed as an issue rather than
a unilateral change.

### B. CSP enforcement (see §2 above)

Filed as a separate follow-up because the work is large enough to warrant its
own PR: enumerate every domain, audit `inline` scripts and migrate to nonces
or hashes, then either enforce via meta or move to HTTP headers.

### C. Render-blocking resources / legacy JavaScript

Already on the residual list in `APPLICATION_AUDIT.md`. Lighthouse still
reports render-blocking CSS/JS on Bridge, Exchange, and OTC plus a legacy
JavaScript warning on Bridge. Performance budgets pass; this is a polish
item.

### D. `npm audit` advisories via `@lhci/cli`

Resolved in #127 (issue #120). The chosen mitigation was intentional and
patch-level only:

* `npm audit fix` (no `--force`) bumped three transitives that ship newer
  patched versions compatible with our installed roots:
  `fast-uri` 3.1.0 → 3.1.2 (high — path traversal / host confusion via
  percent-encoded segments, GHSA-q3j6-qgpj-74h6 / GHSA-v39h-62p7-jpjc), used
  by `html-validate` via `ajv`; `brace-expansion` 5.0.5 → 5.0.6 (moderate —
  DoS, GHSA-jxxr-4gwj-5jf2) under `html-validate`'s `glob`; `ws` 8.20.0 →
  8.20.1 (moderate — uninitialized memory disclosure, GHSA-58qx-3vcg-4xpx)
  under `@11ty/eleventy-dev-server` and Lighthouse's `puppeteer-core`.
* The `tmp` advisory (low — symlink-based arbitrary file write,
  GHSA-52f5-9888-hmc6) only had `npm audit fix --force` available because
  `@lhci/cli@0.15.1` (the latest) still pins `tmp@^0.1.0` (and pulls
  `inquirer@6` → `external-editor@3` → `tmp@0.0.33`). The "force" upgrade
  npm offered would actually **downgrade** `@lhci/cli` to `0.1.0`, losing
  Lighthouse 12 support — not a real fix. Instead, this PR adds a single
  `overrides` entry in `package.json` to force `tmp` to `^0.2.4` for every
  consumer in the tree. Both call sites we depend on are API-compatible
  with `tmp` 0.2.x: `@lhci/cli/src/open/open.js` uses `tmp.fileSync({…})`,
  and `external-editor` uses `tmp.tmpNameSync({…})`. The override was
  verified with `npx lhci healthcheck`, the Playwright suite (532 tests),
  and `npx html-validate "dist/*.html"`.

After the change, `npm audit` reports **0 vulnerabilities** in both the
default and `--omit=dev` views, and `npm ci && npm run build && npm test`
still pass. No advisories were suppressed.

### E. Chart.js loaded from CDN without SRI

Already on the residual list. `statistics-page.njk` loads Chart.js from a CDN
URL with no `integrity=`. Pinning + SRI or self-hosting closes the third-party
script gap.

### F. Admin panel served against demo data

Already on the residual list. The admin shell is access-gated by Telegram
user IDs but the displayed datasets are local/demo. Production
admin operations should be backed by authenticated server APIs before the
surface expands.

## New Follow-Up Issues

Filed against `xlabtg/TON-Bridge` as part of this audit:

* **#117 — Enforce CSP for real** — switch from
  `Content-Security-Policy-Report-Only` in `<meta>` (silently ignored by
  browsers) to either enforced `Content-Security-Policy` in `<meta>` after a
  full origin/inline audit, or to HTTP headers via Cloudflare Worker /
  `_headers`.
* **#118 — Unify bottom navigation across all shells** — pick one canonical
  nav shape and apply it everywhere; document the decision in the design
  system notes.
* **#119 — Migrate Chart.js off CDN** — self-host or pin with SRI to close
  the third-party script gap on `statistics-page.njk`.
* **#120 — Resolve `@lhci/cli` transitive `npm audit` advisories** —
  intentional dependency-maintenance PR rather than blind `audit fix
  --force`.
* **#121 — Replace admin panel demo data with authenticated server APIs** —
  back admin views with real, authorized endpoints before the surface
  expands.
* **#122 — Reduce render-blocking resources on Bridge / Exchange / OTC** —
  Lighthouse polish item to push the perf score further.

## Notes for Reviewers

* The CloudStorage fix is the only behaviour-changing edit in this PR. It is
  defensive and only adds fallbacks; existing tests for `prefs`,
  `achievements`, and `address-book` all still pass.
* The audit deliberately stops short of touching CSP, navigation, and admin
  scope. Those are not "fix it in this PR" items — they need their own scoped
  PRs with their own tests, and each has a corresponding issue.
