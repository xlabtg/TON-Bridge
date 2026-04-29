# TON-Bridge

[![CI](https://github.com/xlabtg/TON-Bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/xlabtg/TON-Bridge/actions/workflows/ci.yml)

🚀 TON Bridge – instant cross‑chain exchange!   ✅ Support for 200+ blockchains and 1200+ coins   ✅ Best prices thanks to CEX / DEX aggregation   ✅ Full security, no registration required  

See [IMPROVEMENTS.md](./IMPROVEMENTS.md) for the project structure analysis and the proposed step-by-step roadmap (UX, performance, virality, security) addressing issue #1.

## Development

Requires [Node.js](https://nodejs.org/) 20.x (LTS Iron). Use [nvm](https://github.com/nvm-sh/nvm) to match the pinned version:

```bash
nvm use
```

### Install dependencies

```bash
npm install
```

### Build CSS

Compiles `assets/sass/style.scss` → `assets/css/style.css` (minified, with sourcemap):

```bash
npm run build:css
```

### Watch CSS (development)

Recompiles automatically on Sass file changes:

```bash
npm run watch:css
```

### Build all

Runs all build steps (CSS compilation + Eleventy HTML generation with env injection):

```bash
npm run build
```

Output goes to `dist/`.

## Configuration

All environment-specific identifiers are injected at build time via
[Eleventy's data cascade](https://www.11ty.dev/docs/data-cascade/) (`src/_data/env.js`).
Copy `.env.example` to `.env` and fill in your values — `.env` is git-ignored and
must never be committed.

| Variable | Description |
|---|---|
| `TG_ANALYTICS_TOKEN` | JWT for [tganalytics.xyz](https://tganalytics.xyz), issued by [@DataChief_bot](https://t.me/DataChief_bot). Rotate via the bot and invalidate the old token after each rotation. |
| `TG_ANALYTICS_APP_NAME` | Analytics identifier registered in @DataChief_bot (usually the bot username). |
| `YANDEX_METRIKA_ID` | Numeric counter ID from [Yandex.Metrika](https://metrika.yandex.ru). |
| `CHANGENOW_LINK_ID` | ChangeNOW partner `link_id` used in the exchange-widget iframe URLs. Obtain from your ChangeNOW partner account. |
| `BOT_USERNAME` | Telegram bot username (without `@`) used for deep links. |

### Building HTML with secrets injected

```bash
cp .env.example .env
# Edit .env and fill in real values
npm run build   # writes dist/*.html with all env values injected via Eleventy
```

The Nunjucks templates (`src/_includes/*.njk`) reference `{{ env.VAR_NAME }}`.
The `src/_data/env.js` data file reads from `.env` (or `process.env` in CI)
and makes the values available to all templates. The build fails fast with a
clear error if any required variable is unset.

### Checking for missing variables

```bash
npm run check:env
```

Exits 0 if all required variables are set, exits 1 with a list of missing
variables otherwise. Useful for verifying your `.env` without running a full build.

### Secret scanning

A [gitleaks](https://github.com/gitleaks/gitleaks) configuration is provided
at `.gitleaks.toml`. To prevent accidental secret commits, add it as a
pre-commit hook:

```bash
# Install gitleaks: https://github.com/gitleaks/gitleaks#installing
gitleaks protect --staged   # run manually before each commit, or wire into pre-commit
```
