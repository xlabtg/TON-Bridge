#!/usr/bin/env node
/**
 * Reads .env (or process.env) and replaces %%VAR_NAME%% placeholders in all
 * *.html files, writing the results to dist/.
 *
 * Usage:
 *   node scripts/inject-env.js [--check]
 *
 * --check  Validate that all required variables are set; exit 1 if any are
 *          missing. Does not write output files.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Load .env if present (never throws; env vars already set take precedence).
try {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
} catch (_) {
  // dotenv is optional at runtime if all vars are already in process.env
}

const REQUIRED_VARS = [
  'TG_ANALYTICS_TOKEN',
  'TG_ANALYTICS_APP_NAME',
  'YANDEX_METRIKA_ID',
  'CHANGENOW_LINK_ID',
  'BOT_USERNAME',
];

const checkOnly = process.argv.includes('--check');

// Verify required variables are set.
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error('Missing required environment variables:');
  missing.forEach((v) => console.error(`  ${v}`));
  if (checkOnly) {
    process.exit(1);
  }
  console.error(
    '\nCopy .env.example to .env and fill in the values, then re-run the build.'
  );
  process.exit(1);
}

if (checkOnly) {
  console.log('All required environment variables are set.');
  process.exit(0);
}

// Build replacement map from %%VAR_NAME%% → actual value.
const replacements = {};
for (const v of REQUIRED_VARS) {
  replacements[`%%${v}%%`] = process.env[v];
}

// Collect all .html files in the project root (not recursing into dist/).
const htmlFiles = fs
  .readdirSync(ROOT)
  .filter((f) => f.endsWith('.html'));

if (htmlFiles.length === 0) {
  console.error('No .html files found in project root.');
  process.exit(1);
}

// Prepare output directory.
fs.mkdirSync(DIST, { recursive: true });

// Copy non-html assets.
const assetsToCopy = ['assets', '__manifest.json', '__service-worker.js'];
for (const asset of assetsToCopy) {
  const src = path.join(ROOT, asset);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(DIST, asset);
  copyRecursive(src, dest);
}

let replaced = 0;

for (const file of htmlFiles) {
  const src = path.join(ROOT, file);
  let content = fs.readFileSync(src, 'utf8');

  for (const [placeholder, value] of Object.entries(replacements)) {
    content = content.split(placeholder).join(value);
  }

  // Warn if any placeholder was not resolved.
  const remaining = content.match(/%%[A-Z_]+%%/g);
  if (remaining) {
    console.warn(`Warning: unresolved placeholders in ${file}: ${[...new Set(remaining)].join(', ')}`);
  }

  fs.writeFileSync(path.join(DIST, file), content, 'utf8');
  replaced++;
}

console.log(`Built ${replaced} HTML file(s) → dist/`);

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}
