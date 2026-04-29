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
├── 00.html, index0.html, index2-ru0.html, index3-ru.html…  # legacy / duplicate copies
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

- [ ] **0.1 Add `.gitignore`, `package.json`, and a Sass build script** — `npm run build` compiles `assets/sass/style.scss` → `assets/css/style.css` and minifies; remove the committed compiled CSS from version control. *(0.5 d)*
- [ ] **0.2 Set up CI** (GitHub Actions): build, HTML-validate, lighthouse-ci on every PR, and auto-deploy to GitHub Pages / static host on merge. *(1 d)*
- [ ] **0.3 De-duplicate HTML via a tiny templating step** — pick one of: 11ty, Astro, or plain `handlebars` precompile. Convert the 14 HTML files to 4 templates × 2 locales. *(2 d)*
- [ ] **0.4 Move secrets out of source** — Telegram Analytics JWT and Yandex.Metrika id should be injected at build time from environment variables and rotated. *(0.5 d)*
- [ ] **0.5 Delete legacy/duplicate files** (`index0.html`, `index2-ru0.html`, `00.html`, etc.) once 0.3 lands. *(0.25 d)*

### Phase 1 — Telegram Mini App best-practices *(highest-leverage UX wins)*

- [ ] **1.1 Use `Telegram.WebApp.MainButton`** for the primary CTA on each tab ("Continue", "Confirm exchange") instead of the bootstrap button at the bottom of the iframe. *(0.5 d)*
- [ ] **1.2 Wire `Telegram.WebApp.BackButton`** to the in-app back navigation on Instruction / Settings screens; remove the custom chevron header. *(0.5 d)*
- [ ] **1.3 Add `HapticFeedback`** on tab switches, copy-to-clipboard, and successful actions. *(0.25 d)*
- [ ] **1.4 Adopt `themeParams`** instead of hard-coded `#1bb2da`: read `tg-theme-button-color`, `tg-theme-bg-color`, etc., so the app blends with the user's Telegram theme. The ChangeNOW widget already accepts `primaryColor`/`backgroundColor`/`darkMode` query params — pass theme values through. *(1 d)*
- [ ] **1.5 Persist user preferences in `Telegram.WebApp.CloudStorage`** (last-used pair, language, dark-mode override) so they sync across devices. *(0.5 d)*
- [ ] **1.6 Replace the EN/RU page swap with in-place i18n** (e.g. `i18next` or a 50-line custom loader); detect `Telegram.WebApp.initDataUnsafe.user.language_code` for the default. *(1.5 d)*
- [ ] **1.7 Validate `initData` on a tiny backend** (Cloudflare Worker is enough) before doing anything user-specific — required for any future personalized feature and a baseline anti-fraud measure. *(1 d)*
- [ ] **1.8 Add a `BiometricManager` opt-in** to gate large OTC trades. *(0.5 d)*
- [ ] **1.9 Use `Telegram.WebApp.SettingsButton`** to open the in-app settings, freeing the hamburger menu for navigation. *(0.25 d)*

### Phase 2 — Performance, PWA, offline

- [ ] **2.1 Fix the service worker**: precache CSS/JS/icons/fonts, add stale-while-revalidate for the iframe shell, version-bump on deploy. *(0.5 d)*
- [ ] **2.2 Update `__manifest.json`**: real `name` ("TON Bridge"), `id`, `description`, `categories`, `screenshots`, `shortcuts` (Bridge / Exchange / OTC). *(0.25 d)*
- [ ] **2.3 Replace `unpkg.com/ionicons` CDN with a self-hosted, tree-shaken icon set** (or inline SVG sprite) to cut blocking module download. *(0.5 d)*
- [ ] **2.4 Lazy-load the ChangeNOW iframe** behind an "Open exchange" button — currently three iframes worth of widget JS load on every navigation. *(0.5 d)*
- [ ] **2.5 Inline above-the-fold CSS, defer the 150 KB `style.css`**; add `<link rel="preconnect">` for `changenow.io`, `telegram.org`, `tganalytics.xyz`. *(0.5 d)*
- [ ] **2.6 Set a Lighthouse performance budget in CI** (LCP < 2.5 s on 4G, total JS < 200 KB). *(0.25 d)*

### Phase 3 — Product surface beyond the iframe

- [ ] **3.1 Native rate ticker on the home screen** — pull TON / USDT / BTC / ETH spot prices from CoinGecko or ChangeNOW's `/api/v1/min-amount` and render a sparkline (the Splide and ApexCharts plugins are already vendored). *(1 d)*
- [ ] **3.2 In-app order history** — read it from ChangeNOW via the partner API (link_id is already present) and store the txn id + status in `CloudStorage`. Polled status updates with `Telegram.WebApp.HapticFeedback.notificationOccurred('success')` on completion. *(2 d)*
- [ ] **3.3 Push notifications via the bot** — when an exchange leaves "exchanging" state, send a Telegram message from `@TONBridge_robot` ("Your TON arrived, tap to view"). *(1 d)*
- [ ] **3.4 Finish the Statistics tab** (`index4.html`) — translate to EN, link it from the bottom menu, replace mocked numbers with live data, and add it as a `shortcut` in the manifest. *(1 d)*
- [ ] **3.5 Wallet connect (TonConnect 2)** — show the user's TON balance and let them prefill the "from" amount with one tap. *(2 d)*
- [ ] **3.6 Address book** — last N recipient addresses saved to `CloudStorage`, accessible from a quick-pick chip above the iframe. *(1 d)*

### Phase 4 — Virality & growth loops

- [ ] **4.1 Telegram Stars referral program** — give the inviter a fee rebate (paid in Stars) for every successful exchange a referee makes. Build on `Telegram.WebApp.openInvoice` / `requestWriteAccess`. *(2 d)*
- [ ] **4.2 `shareToStory` after a successful trade** — a pre-rendered story card ("I just bridged 0.5 TON in 38 s with @TONBridge_robot — try it ↗") with the deep-link sticker. *(1 d)*
- [ ] **4.3 Deep-link presets** — `t.me/TONBridge_robot/app?startapp=ton_bsc_10` opens directly on the Bridge tab pre-filled. Encode `from-to-amount` in `start_param`. *(0.5 d)*
- [ ] **4.4 Social proof widget** — "12 343 bridges in the last 24 h" pulled from the partner stats endpoint, refreshed every minute. *(0.5 d)*
- [ ] **4.5 Achievement / level system** persisted in `CloudStorage` (Bronze: 1 trade, Silver: 10, Gold: 100). Unlock cosmetic themes; users want to share level-ups via 4.2. *(1 d)*
- [ ] **4.6 Group-chat sharing flow** — add a "Send to chat" button using `Telegram.WebApp.switchInlineQuery` so a user can paste a quote into any chat as an inline result. *(1 d)*
- [ ] **4.7 Leaderboard channel** — daily auto-post of top bridges to a public channel; the channel post links back to `/app?startapp=…`. *(0.5 d)*
- [ ] **4.8 Add directory listings** — TON App, ton.app, tonapps.com, dappradar — each with a unique UTM so we can attribute. *(0.5 d)*

### Phase 5 — Trust, security, accessibility, polish

- [ ] **5.1 Replace the Lorem-ipsum cookie banner** with a real privacy notice and a link to a `/privacy` page. *(0.25 d)*
- [ ] **5.2 Add CSP meta tag and SRI** for every external `<script>` and `<link rel=stylesheet>`. Lock `ionicons` and `chart.js` to a version with hashes. *(0.5 d)*
- [ ] **5.3 Accessibility pass** — `alt=` on every image, `aria-label` on icon-only buttons, focus rings on keyboard nav, `prefers-reduced-motion` for the splash loader. *(1 d)*
- [ ] **5.4 SEO/OG tags** — per-page `<title>`, `<meta name=description>`, `og:image`, `og:type`, `twitter:card`. Required for the share-to-Telegram link preview to look professional. *(0.5 d)*
- [ ] **5.5 Add a `humans.txt` / `LICENSE`** and surface the Finapp template attribution per its EULA. *(0.25 d)*
- [ ] **5.6 Crash & error reporting** — Sentry browser SDK, sourcemap upload in CI. *(0.5 d)*
- [ ] **5.7 Replace `<center>`, `<table>`-for-layout, and inline styles in `index.html` with semantic flexbox/grid** while we are de-duplicating in 0.3. *(0.5 d)*

---

## 3. Suggested execution order (first-week plan)

1. Day 1: tasks **0.1 → 0.5** (foundations + de-dup)
2. Day 2: **1.1, 1.2, 1.3, 1.4** (Telegram-native CTA & theme)
3. Day 3: **2.1, 2.2, 2.4** (PWA + perf wins)
4. Day 4: **1.6, 1.5** (real i18n + CloudStorage prefs)
5. Day 5: **4.3, 4.2, 5.1, 5.4** (deep-links + share-to-story + privacy + OG)

After this first week the app already feels native to Telegram, loads under 2 s on 4G, has shareable deep-links, and a privacy-respecting analytics setup — which is the realistic prerequisite for the larger Phase-3/4 features.

## 4. Out of scope for this proposal

- Replacing ChangeNOW with our own liquidity routing.
- Native iOS/Android wrappers — the PWA path covers it.
- Smart-contract custody — explicit non-goal per the homepage copy ("we do not control your funds").
