# TON-Bridge
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

Runs all build steps (CSS compilation + HTML env injection):

```bash
npm run build
```

## Configuration

All environment-specific identifiers are injected at build time. Copy
`.env.example` to `.env` and fill in your values — `.env` is git-ignored and
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
npm run build:html   # writes dist/*.html with placeholders replaced
```

The source `*.html` files contain `%%VAR_NAME%%` placeholders. The
`npm run build:html` command (or `npm run build`) reads your `.env` file and
writes the final files to `dist/`.

### Checking for missing variables

```bash
npm run check:env
```

Exits with code 1 and lists any missing variables without writing output files.

### Secret scanning

A [gitleaks](https://github.com/gitleaks/gitleaks) configuration is provided
at `.gitleaks.toml`. To prevent accidental secret commits, add it as a
pre-commit hook:

```bash
# Install gitleaks: https://github.com/gitleaks/gitleaks#installing
gitleaks protect --staged   # run manually before each commit, or wire into pre-commit
```
