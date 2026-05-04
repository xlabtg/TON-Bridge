# TON-Bridge — Improvement Proposal

> Scope: per issue [#1](https://github.com/xlabtg/TON-Bridge/issues/1), this document is **analysis and proposed step-by-step tasks only**. The application code is not modified.

## 1. Project structure (as observed)

The repository is a static Telegram Mini App (TMA) bundled as a PWA. It is built on the third-party **Finapp** Bootstrap mobile template (`assets/js/base.js` header, version 2.2.1).

```
.
├── README.md                         # one-liner marketing pitch
├── __manifest.json                   # PWA manifest (name "Finapp", icons 72→512)
├── __service-worker.js               # cache-first SW, only precaches index.html
├── index.html / index-ru.html        # Bridge tab (ChangeNOW widget: TON → TON-BSC)
├── index2.html / index2-ru.html      # Exchange tab (ChangeNOW widget: BTC → TON)
├── index3.html / index3-ru.html      # OTC tab (ChangeNOW widget: USDT-TON → TON, $1M)
├── index4.html                       # Statistics dashboard (Chart.js, RU only)
├── 0.html / 1.html / 2.html (+ -ru)  # static "Instruction" pages
├── app-settings.html / -ru.html      # Dark mode + EN/RU toggle
└── assets/
    ├── css/style.css (≈150 KB), keyboard-styles.css
    ├── sass/  (Finapp source: _blocks, _darkmode, _rtl, _variables, layout/, ui/)
    ├── js/base.js, keyboard-handler.js, lib/bootstrap.bundle.min.js
    └── js/plugins/{splide, apexcharts}
```

### Integrations and third-party scripts already wired

- `telegram-web-app.js` — TMA SDK (theme sync, expand, header color)
- `tganalytics.xyz` — Telegram Analytics with embedded JWT token
- `mc.yandex.ru/metrika/tag.js` — Yandex.Metrika (id 98019798, webvisor on)
- `changenow.io/embeds/exchange-widget/v2/widget.html` — the actual exchange UX
- `ton.app/a2/badge/topapp` — TON App "top app" badge
- `unpkg.com/ionicons@5.5.2` — icon font (ESM module from CDN)

### Key observations

1. **The product surface is essentially three iframes** to ChangeNOW with different `from/to/amount` presets. All "Bridge / Exchange / OTC" pages share 90 %+ of their HTML.
2. **Massive duplication**: `index.html` vs `index-ru.html`, plus orphaned `*0.html` copies. There is no template engine — every change has to be made in 8–14 files.
3. **PWA manifest is generic** (`name: "Finapp"`, `start_url: index.html`, no `id`, no shortcuts, no screenshots).
4. **Service worker only precaches `index.html`** (line 14 of `__service-worker.js`); CSS/JS/images are not cached, so first-paint after offline is broken.
5. **Telegram-specific UX is shallow**: `WebApp.ready()`, `expand()`, `setHeaderColor()`, theme sync. No `MainButton`, `BackButton`, `HapticFeedback`, `BiometricManager`, `CloudStorage`, `shareToStory`, `requestWriteAccess`, `openInvoice`, or settings menu integration.
6. **Analytics token is committed in plaintext** in every HTML page (`tganalytics.xyz` JWT). Yandex.Metrika id is also hard-coded across pages.
7. **Hard-coded English/Russian only**, switched by navigating between `*-ru.html` pages and persisted nowhere.
8. **No build step** (no `package.json`, no `.gitignore`, no CI). The committed `style.css` is generated, the `sass/` source is shipped alongside.
9. **Accessibility / SEO**: missing `alt` text on several images, no `<meta property="og:*">`, missing canonical URLs, the `<title>` is the same on most pages.
10. **Security headers**: external scripts load with no SRI (`integrity=`), no CSP meta tag, the cookie banner text is Lorem ipsum.
11. **Statistics tab (`index4.html`) is RU-only and not linked** from the bottom menu — a half-finished feature.
12. **No referral / affiliate hook beyond the static `link_id` in the iframe URL** — virality is left entirely to ChangeNOW.

---

## 2. Proposed step-by-step tasks

Tasks are ordered so each builds on the previous one. Estimates are rough developer-days.

### Phase 0 — Hygiene & foundations *(prereq for everything else)*

- [ ] **0.1 Add `.gitignore`, `package.json`, and a Sass build script** ([#3](https://github.com/xlabtg/TON-Bridge/issues/3)) — `npm run build` compiles `assets/sass/style.scss` → `assets/css/style.css` and minifies; remove the committed compiled CSS from version control. *(0.5 d)*
- [ ] **0.2 Set up CI** ([#4](https://github.com/xlabtg/TON-Bridge/issues/4)) — GitHub Actions: build, HTML-validate, lighthouse-ci on every PR, and auto-deploy to GitHub Pages / static host on merge. *(1 d)*
- [ ] **0.3 De-duplicate HTML via a tiny templating step** ([#5](https://github.com/xlabtg/TON-Bridge/issues/5)) — pick one of: 11ty, Astro, or plain `handlebars` precompile. Convert the 14 HTML files to 4 templates × 2 locales. *(2 d)*
- [ ] **0.4 Move secrets out of source** ([#6](https://github.com/xlabtg/TON-Bridge/issues/6)) — Telegram Analytics JWT and Yandex.Metrika id should be injected at build time from environment variables and rotated. *(0.5 d)*
- [x] **0.5 Delete legacy/duplicate files** ([#7](https://github.com/xlabtg/TON-Bridge/issues/7)) — `index0.html`, `index2-ru0.html`, `00.html`, etc., once 0.3 lands. *(0.25 d)*

### Phase 1 — Telegram Mini App best-practices *(highest-leverage UX wins)*

- [ ] **1.1 Use `Telegram.WebApp.MainButton`** ([#8](https://github.com/xlabtg/TON-Bridge/issues/8)) — primary CTA on each tab ("Continue", "Confirm exchange") instead of the bootstrap button at the bottom of the iframe. *(0.5 d)*
- [ ] **1.2 Wire `Telegram.WebApp.BackButton`** ([#9](https://github.com/xlabtg/TON-Bridge/issues/9)) — in-app back navigation on Instruction / Settings screens; remove the custom chevron header. *(0.5 d)*
- [ ] **1.3 Add `HapticFeedback`** ([#10](https://github.com/xlabtg/TON-Bridge/issues/10)) — on tab switches, copy-to-clipboard, and successful actions. *(0.25 d)*
- [ ] **1.4 Adopt `themeParams`** ([#11](https://github.com/xlabtg/TON-Bridge/issues/11)) — instead of hard-coded `#1bb2da`: read `tg-theme-button-color`, `tg-theme-bg-color`, etc., so the app blends with the user's Telegram theme. The ChangeNOW widget already accepts `primaryColor`/`backgroundColor`/`darkMode` query params — pass theme values through. *(1 d)*
- [ ] **1.5 Persist user preferences in `Telegram.WebApp.CloudStorage`** ([#12](https://github.com/xlabtg/TON-Bridge/issues/12)) — last-used pair, language, dark-mode override, so they sync across devices. *(0.5 d)*
- [ ] **1.6 Replace the EN/RU page swap with in-place i18n** ([#13](https://github.com/xlabtg/TON-Bridge/issues/13)) — e.g. `i18next` or a 50-line custom loader; detect `Telegram.WebApp.initDataUnsafe.user.language_code` for the default. *(1.5 d)*
- [ ] **1.7 Validate `initData` on a tiny backend** ([#14](https://github.com/xlabtg/TON-Bridge/issues/14)) — Cloudflare Worker is enough; required for any future personalized feature and a baseline anti-fraud measure. *(1 d)*
- [ ] **1.8 Add a `BiometricManager` opt-in** ([#15](https://github.com/xlabtg/TON-Bridge/issues/15)) — to gate large OTC trades. *(0.5 d)*
- [ ] **1.9 Use `Telegram.WebApp.SettingsButton`** ([#16](https://github.com/xlabtg/TON-Bridge/issues/16)) — open the in-app settings, freeing the hamburger menu for navigation. *(0.25 d)*

### Phase 2 — Performance, PWA, offline

- [ ] **2.1 Fix the service worker** ([#17](https://github.com/xlabtg/TON-Bridge/issues/17)) — precache CSS/JS/icons/fonts, add stale-while-revalidate for the iframe shell, version-bump on deploy. *(0.5 d)*
- [ ] **2.2 Update `__manifest.json`** ([#18](https://github.com/xlabtg/TON-Bridge/issues/18)) — real `name` ("TON Bridge"), `id`, `description`, `categories`, `screenshots`, `shortcuts` (Bridge / Exchange / OTC). *(0.25 d)*
- [ ] **2.3 Replace `unpkg.com/ionicons` CDN** ([#19](https://github.com/xlabtg/TON-Bridge/issues/19)) — with a self-hosted, tree-shaken icon set (or inline SVG sprite) to cut blocking module download. *(0.5 d)*
- [ ] **2.4 Lazy-load the ChangeNOW iframe** ([#20](https://github.com/xlabtg/TON-Bridge/issues/20)) — behind an "Open exchange" button; currently three iframes worth of widget JS load on every navigation. *(0.5 d)*
- [ ] **2.5 Inline above-the-fold CSS, defer the 150 KB `style.css`** ([#21](https://github.com/xlabtg/TON-Bridge/issues/21)) — add `<link rel="preconnect">` for `changenow.io`, `telegram.org`, `tganalytics.xyz`. *(0.5 d)*
- [ ] **2.6 Set a Lighthouse performance budget in CI** ([#22](https://github.com/xlabtg/TON-Bridge/issues/22)) — LCP < 2.5 s on 4G, total JS < 200 KB. *(0.25 d)*

### Phase 3 — Product surface beyond the iframe

- [ ] **3.1 Native rate ticker on the home screen** ([#23](https://github.com/xlabtg/TON-Bridge/issues/23)) — pull TON / USDT / BTC / ETH spot prices from CoinGecko or ChangeNOW's `/api/v1/min-amount` and render a sparkline (the Splide and ApexCharts plugins are already vendored). *(1 d)*
- [ ] **3.2 In-app order history** ([#24](https://github.com/xlabtg/TON-Bridge/issues/24)) — read it from ChangeNOW via the partner API (link_id is already present) and store the txn id + status in `CloudStorage`. Polled status updates with `Telegram.WebApp.HapticFeedback.notificationOccurred('success')` on completion. *(2 d)*
- [ ] **3.3 Push notifications via the bot** ([#25](https://github.com/xlabtg/TON-Bridge/issues/25)) — when an exchange leaves "exchanging" state, send a Telegram message from `@TONBridge_robot` ("Your TON arrived, tap to view"). *(1 d)*
- [ ] **3.4 Finish the Statistics tab** ([#26](https://github.com/xlabtg/TON-Bridge/issues/26)) — `index4.html`: translate to EN, link it from the bottom menu, replace mocked numbers with live data, and add it as a `shortcut` in the manifest. *(1 d)*
- [ ] **3.5 Wallet connect (TonConnect 2)** ([#27](https://github.com/xlabtg/TON-Bridge/issues/27)) — show the user's TON balance and let them prefill the "from" amount with one tap. *(2 d)*
- [ ] **3.6 Address book** ([#28](https://github.com/xlabtg/TON-Bridge/issues/28)) — last N recipient addresses saved to `CloudStorage`, accessible from a quick-pick chip above the iframe. *(1 d)*

### Phase 4 — Virality & growth loops

- [ ] **4.1 Telegram Stars referral program** ([#29](https://github.com/xlabtg/TON-Bridge/issues/29)) — give the inviter a fee rebate (paid in Stars) for every successful exchange a referee makes. Build on `Telegram.WebApp.openInvoice` / `requestWriteAccess`. *(2 d)*
- [ ] **4.2 `shareToStory` after a successful trade** ([#30](https://github.com/xlabtg/TON-Bridge/issues/30)) — a pre-rendered story card ("I just bridged 0.5 TON in 38 s with @TONBridge_robot — try it ↗") with the deep-link sticker. *(1 d)*
- [ ] **4.3 Deep-link presets** ([#31](https://github.com/xlabtg/TON-Bridge/issues/31)) — `t.me/TONBridge_robot/app?startapp=ton_bsc_10` opens directly on the Bridge tab pre-filled. Encode `from-to-amount` in `start_param`. *(0.5 d)*
- [ ] **4.4 Social proof widget** ([#32](https://github.com/xlabtg/TON-Bridge/issues/32)) — "12 343 bridges in the last 24 h" pulled from the partner stats endpoint, refreshed every minute. *(0.5 d)*
- [ ] **4.5 Achievement / level system** ([#33](https://github.com/xlabtg/TON-Bridge/issues/33)) — persisted in `CloudStorage` (Bronze: 1 trade, Silver: 10, Gold: 100). Unlock cosmetic themes; users want to share level-ups via 4.2. *(1 d)*
- [ ] **4.6 Group-chat sharing flow** ([#34](https://github.com/xlabtg/TON-Bridge/issues/34)) — add a "Send to chat" button using `Telegram.WebApp.switchInlineQuery` so a user can paste a quote into any chat as an inline result. *(1 d)*
- [ ] **4.7 Leaderboard channel** ([#35](https://github.com/xlabtg/TON-Bridge/issues/35)) — daily auto-post of top bridges to a public channel; the channel post links back to `/app?startapp=…`. *(0.5 d)*
- [x] **4.8 Add directory listings** ([#36](https://github.com/xlabtg/TON-Bridge/issues/36)) — TON App, ton.app, tonapps.com, dappradar — each with a unique UTM so we can attribute. *(0.5 d)*

### Phase 5 — Trust, security, accessibility, polish

- [ ] **5.1 Replace the Lorem-ipsum cookie banner** ([#37](https://github.com/xlabtg/TON-Bridge/issues/37)) — with a real privacy notice and a link to a `/privacy` page. *(0.25 d)*
- [ ] **5.2 Add CSP meta tag and SRI** ([#38](https://github.com/xlabtg/TON-Bridge/issues/38)) — for every external `<script>` and `<link rel=stylesheet>`. Lock `ionicons` and `chart.js` to a version with hashes. *(0.5 d)*
- [ ] **5.3 Accessibility pass** ([#39](https://github.com/xlabtg/TON-Bridge/issues/39)) — `alt=` on every image, `aria-label` on icon-only buttons, focus rings on keyboard nav, `prefers-reduced-motion` for the splash loader. *(1 d)*
- [ ] **5.4 SEO/OG tags** ([#40](https://github.com/xlabtg/TON-Bridge/issues/40)) — per-page `<title>`, `<meta name=description>`, `og:image`, `og:type`, `twitter:card`. Required for the share-to-Telegram link preview to look professional. *(0.5 d)*
- [ ] **5.5 Add a `humans.txt` / `LICENSE`** ([#41](https://github.com/xlabtg/TON-Bridge/issues/41)) — surface the Finapp template attribution per its EULA. *(0.25 d)*
- [ ] **5.6 Crash & error reporting** ([#42](https://github.com/xlabtg/TON-Bridge/issues/42)) — Sentry browser SDK, sourcemap upload in CI. *(0.5 d)*
- [ ] **5.7 Replace `<center>`, `<table>`-for-layout, and inline styles** ([#43](https://github.com/xlabtg/TON-Bridge/issues/43)) — in `index.html` with semantic flexbox/grid while we are de-duplicating in 0.3. *(0.5 d)*

---

## 3. Suggested execution order (first-week plan)

1. Day 1: tasks **0.1 → 0.5** (foundations + de-dup)
2. Day 2: **1.1, 1.2, 1.3, 1.4** (Telegram-native CTA & theme)
3. Day 3: **2.1, 2.2, 2.4** (PWA + perf wins)
4. Day 4: **1.6, 1.5** (real i18n + CloudStorage prefs)
5. Day 5: **4.3, 4.2, 5.1, 5.4** (deep-links + share-to-story + privacy + OG)

After this first week the app already feels native to Telegram, loads under 2 s on 4G, has shareable deep-links, and a privacy-respecting analytics setup — which is the realistic prerequisite for the larger Phase-3/4 features.

### Phase 6 — Affiliate program (TBC points & single-level referrals)

This phase turns the existing flat ChangeNOW `link_id` partnership into a first-party loyalty + referral economy denominated in **internal points** that are redeemable for **TBC** tokens (the native token of the [TONBANKCARD](https://tonbankcard.io/) ecosystem).

#### 6.0 Economic model & arithmetic

**Inputs (from product owner):**

| Variable                     | Value      | Source                        |
| ---------------------------- | ---------- | ----------------------------- |
| Service commission per swap  | **0.40 %** of USD turnover | partner agreement with ChangeNOW |
| Single-level referral share  | **0.10 % – 0.20 %** of referee's USD turnover (configurable) | this proposal |
| Trader cashback              | **0.10 % – 0.20 %** of own USD turnover (configurable) | this proposal |
| Conversion rate              | **10 points = 1 TBC**     | this proposal |
| TBC market rate              | **$0.0003 per TBC**       | TONBANKCARD spot |
| ⇒ Implied point value        | **$0.00003 per point**    | derived |

**House economics — what's left after rebates (worst/recommended/best case):**

| Cashback | Referral | House keeps | % of original 0.40 % retained |
| -------- | -------- | ----------- | ----------------------------- |
| 0.20 %   | 0.20 %   | 0.00 %      | 0 % — break-even, do not ship |
| **0.10 %** | **0.10 %** | **0.20 %** | **50 % — recommended default** |
| 0.10 %   | 0.20 %   | 0.10 %      | 25 % |
| 0.20 %   | 0.10 %   | 0.10 %      | 25 % |

The recommended default is **0.10 % trader cashback + 0.10 % referrer share**, leaving the house with 0.20 % gross margin (half of the original commission). All three knobs (`cashback_bps`, `referral_bps`, `service_bps`) MUST be runtime-configurable so the program can be tuned without redeploys.

**Point award formula:**

```
points_awarded(user, swap) = floor( (turnover_usd × bps / 10_000) / point_value_usd )
                           = floor(  turnover_usd × bps / 10_000 / 0.00003 )
                           = floor(  turnover_usd × bps × 3.3333… )
```

Where `bps` is whichever rate applies to that user's role in the swap (`cashback_bps` for the trader, `referral_bps` for their inviter).

For the recommended **0.10 %** rate this collapses to a memorable rule of thumb:

> **Every $1 of swap turnover ≈ 33 points ≈ 3.3 TBC ≈ $0.001 cashback.**

**Worked examples (recommended 0.10 % / 0.10 % split):**

| Swap turnover | House commission (0.40 %) | Trader cashback (0.10 %) | Trader points | Referrer points | House net (0.20 %) |
| ------------- | ------------------------- | ------------------------ | ------------- | --------------- | ------------------ |
| $10           | $0.04                     | $0.01                    | 333 pts (≈ 33.3 TBC)         | 333 pts          | $0.02 |
| $100          | $0.40                     | $0.10                    | 3 333 pts (≈ 333.3 TBC)      | 3 333 pts        | $0.20 |
| $1 000        | $4.00                     | $1.00                    | 33 333 pts (≈ 3 333.3 TBC)   | 33 333 pts       | $2.00 |
| $10 000       | $40.00                    | $10.00                   | 333 333 pts                  | 333 333 pts      | $20.00 |
| $1 000 000 *(OTC)* | $4 000.00            | $1 000.00                | 33 333 333 pts (≈ 3.33 M TBC) | 33 333 333 pts  | $2 000.00 |

**Redemption:**

```
tbc_to_credit = floor(points_to_redeem / 10)            # 10 points → 1 TBC
usd_value     = tbc_to_credit × $0.0003
```

A redemption hands the TBC to the user's TONBANKCARD wallet (or queues an off-chain credit if the wallet is not yet linked). Minimum redemption: **100 points (10 TBC)** to keep the on-chain transfer cost below the redeemed value.

#### 6.1 Roadmap items

- [ ] **6.1 Define the data model** ([#44](https://github.com/xlabtg/TON-Bridge/issues/44)) — `users(telegram_id, ref_code, referred_by, tbc_address?)`, `swaps(id, user_id, partner_txn_id, turnover_usd, status)`, `point_ledger(id, user_id, swap_id, role[trader|referrer|admin_grant], delta_points, created_at)`, `redemptions(id, user_id, points_spent, tbc_amount, status, on_chain_tx?)`. Append-only ledger so balances are always reconstructible. *(1 d)*
- [ ] **6.2 Issue every user a referral code** ([#45](https://github.com/xlabtg/TON-Bridge/issues/45)) — short (8 char), URL-safe, generated on first `initData` validation; deep-link is `t.me/TONBridge_robot/app?startapp=ref_<CODE>` (re-uses the deep-link plumbing from 4.3). *(0.5 d)*
- [ ] **6.3 Capture `referred_by` once and only once** ([#46](https://github.com/xlabtg/TON-Bridge/issues/46)) — first time a user opens the app from a `ref_<CODE>` deep-link, persist their inviter; subsequent ref-link visits do not overwrite. Self-referral and cyclic referral are rejected. *(0.5 d)*
- [ ] **6.4 USD turnover oracle** ([#47](https://github.com/xlabtg/TON-Bridge/issues/47)) — for every completed ChangeNOW swap, resolve a USD value at swap-completion time using a single source-of-truth (CoinGecko `simple/price` is enough; cache 60 s). Store the rate alongside the swap row so points are reproducible. *(1 d)*
- [ ] **6.5 Point accrual job** ([#48](https://github.com/xlabtg/TON-Bridge/issues/48)) — a Cloudflare Worker cron / queue that polls the ChangeNOW partner API for `link_id`-attributed swaps in `finished` state, looks up the user via `partner_user_id` query param we attach when opening the iframe, then writes two `point_ledger` rows (trader + referrer if applicable) using the formula in 6.0. Idempotent on `partner_txn_id`. *(2 d)*
- [ ] **6.6 Redemption flow** ([#49](https://github.com/xlabtg/TON-Bridge/issues/49)) — in-app "Redeem" screen showing point balance, equivalent TBC and USD, and a slider with a **100-point minimum**. Confirmation goes through `Telegram.WebApp.showConfirm`, then a backend call to TONBANKCARD's API to credit TBC. Failed credits roll the ledger back. *(2 d)*
- [x] **6.7 Anti-fraud guardrails** ([#50](https://github.com/xlabtg/TON-Bridge/issues/50)) — (a) referral bonus only pays out after the referee's swap reaches `finished` (not `confirming`); (b) per-user daily turnover cap on point-awarding (e.g. $50 k/day) configurable via env var; (c) flag accounts where >80 % of inviter's volume is from a single referee; (d) Telegram-account-age ≥ 7 d before points become withdrawable. *(1 d)*
- [ ] **6.8 Affiliate dashboard** ([#51](https://github.com/xlabtg/TON-Bridge/issues/51)) — replaces the half-finished `index4.html`: shows the user's lifetime turnover, points balance, TBC equivalent, last 10 swaps, and referral leaderboard (referee count, referral turnover, referral points earned). Uses the existing ApexCharts plugin. *(2 d)*
- [ ] **6.9 TONBANKCARD wallet linking** ([#52](https://github.com/xlabtg/TON-Bridge/issues/52)) — TonConnect 2 flow that proves the user owns a TON wallet, then registers it as their TBC payout address. Re-uses the wallet code from 3.5. *(1 d)*
- [ ] **6.10 Admin / ops surface** ([#53](https://github.com/xlabtg/TON-Bridge/issues/53)) — read-only Grafana (or simple `/admin` page behind a Telegram-id allow-list) showing global turnover, points outstanding, points redeemed, TBC paid, fraud flags. *(1 d)*
- [ ] **6.11 T&C, disclosure, and rate-card UI** ([#54](https://github.com/xlabtg/TON-Bridge/issues/54)) — a `/program` static page that explains the math from §6.0 in plain language (EN + RU), plus a tooltip on every "+N points" pill that shows the underlying formula. Required for trust and regulatory hygiene. *(0.5 d)*
- [ ] **6.12 Configurable rate knobs** ([#55](https://github.com/xlabtg/TON-Bridge/issues/55)) — `service_bps`, `cashback_bps`, `referral_bps`, `min_redeem_points`, `daily_turnover_cap_usd` exposed as environment variables; changing them only affects swaps **after** the change (historical ledger is immutable). *(0.5 d)*

**Phase 6 ordering:** 6.1 → 6.2 → 6.3 → 6.4 → 6.5 → 6.7 → 6.6 → 6.9 → 6.8 → 6.11 → 6.10 → 6.12. The redemption flow (6.6) is intentionally gated behind anti-fraud (6.7), and the dashboard (6.8) is gated behind a wallet linking (6.9) so the displayed TBC value is real.

---

## 4. Out of scope for this proposal

- Replacing ChangeNOW with our own liquidity routing.
- Native iOS/Android wrappers — the PWA path covers it.
- Smart-contract custody — explicit non-goal per the homepage copy ("we do not control your funds").
- Multi-level (MLM-style) referrals — Phase 6 is intentionally **single-level** to stay clear of pyramid-scheme regulation.
- Issuing TBC tokens — TBC is the existing TONBANKCARD token; this proposal only credits, never mints.
