# Application Audit

Date: 2026-05-04

Scope: app-wide review for configuration leaks, security header consistency, navigation regressions, build health, localization integrity, automated browser behavior, and performance budgets.

## Verification Matrix

| Check | Result | Notes |
| --- | --- | --- |
| `npm ci` | Passed | `npm audit` still reports transitive low/moderate advisories under `@lhci/cli`; the suggested fix is not a safe patch-level upgrade. |
| `npm run check:i18n` | Passed | Locale key coverage remains consistent. |
| `npm run build` | Passed | Build requires `TG_ANALYTICS_TOKEN`, `TG_ANALYTICS_APP_NAME`, `YANDEX_METRIKA_ID`, `CHANGENOW_LINK_ID`, and `BOT_USERNAME`. |
| `npm run validate:manifest` | Passed | Manifest/screenshots satisfy the current validator. |
| `npx html-validate "dist/*.html"` | Passed | Generated top-level HTML validates. |
| `npm run test:unit` | Passed | Worker and helper unit tests pass. |
| `npm run test:schema` | Passed | Schema validations pass. |
| `npm run test:auth-verify` | Passed | Telegram auth verification tests pass. |
| `npm run test:accrual` | Passed | Points accrual tests pass. |
| `npm run test:redeem` | Passed | Redeem business logic tests pass. |
| `npm run test:rate-config` | Passed | Rate configuration tests pass. |
| `npm run test:installer` | Passed | Installer configuration tests pass. |
| `npm test` | Passed | 512 Playwright tests passed in the audited build. |
| `npx lhci autorun` | Passed with warnings | Budgets passed; Lighthouse still reports render-blocking resources on main flows and a legacy JavaScript warning on Bridge. |

## Fixed Findings

1. Analytics credentials and the Yandex.Metrika counter ID were hardcoded in runtime sources. They now come from build-time environment injection, and regression coverage checks that the committed legacy token and app name are not emitted.
2. `program`, `redeem`, and `admin` pages were missing CSP report-only coverage and SRI/crossorigin attributes for `telegram-web-app.js`. Coverage now includes these pages.
3. `redeem` also loaded Telegram Analytics without SRI/crossorigin and kept hardcoded analytics values. It now uses the same SRI and environment-injected analytics config as the referral flow.
4. The admin 403 page linked to `admin/index.html` instead of the app root. The fallback link now points to `../index.html`, with a Playwright regression test.

## Residual Findings

1. CSP remains report-only and still allows inline scripts/styles because the app currently relies on inline initialization blocks. A future hard-enforcement pass should migrate those blocks to nonces, hashes, or bundled local files.
2. Lighthouse reports render-blocking resources on Bridge, Exchange, and OTC pages, plus a legacy JavaScript warning on Bridge. Budgets pass, but these are good candidates for a performance follow-up.
3. `npm audit` reports transitive advisories through the Lighthouse CI toolchain. The available automatic fix is not a safe compatible upgrade, so this should be tracked with dependency maintenance rather than applied blindly.
4. The statistics page still uses a CDN Chart.js URL. Pinning to an exact asset with SRI or self-hosting would make third-party script policy more consistent.
5. The admin panel is gated by Telegram user IDs, but the displayed datasets are still local/demo data. Production admin operations should be backed by authenticated server APIs before expanding the surface.
