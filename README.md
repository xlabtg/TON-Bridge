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

Runs all build steps:

```bash
npm run build
```
