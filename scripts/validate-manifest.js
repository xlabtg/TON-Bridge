#!/usr/bin/env node
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import validateWebAppManifest from 'web-app-manifest-validator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, '..', 'dist', '__manifest.json');

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} catch (e) {
  console.error(`❌ Failed to parse ${manifestPath}: ${e.message}`);
  process.exit(1);
}

const errors = [];

const standardsManifest = {
  background_color: manifest.background_color,
  description: manifest.description,
  dir: manifest.dir,
  display: manifest.display,
  icons: manifest.icons,
  lang: manifest.lang,
  name: manifest.name,
  orientation: manifest.orientation,
  scope: manifest.scope,
  screenshots: (manifest.screenshots || []).map(({ src, sizes, type }) => ({ src, sizes, type })),
  short_name: manifest.short_name,
  start_url: manifest.start_url,
  theme_color: manifest.theme_color,
};

for (const error of validateWebAppManifest(standardsManifest)) {
  errors.push(`web-app-manifest-validator: ${error}`);
}

function require_field(field, expectedValue) {
  if (manifest[field] === undefined || manifest[field] === null) {
    errors.push(`Missing required field: "${field}"`);
  } else if (expectedValue !== undefined && manifest[field] !== expectedValue) {
    errors.push(`Field "${field}" must be "${expectedValue}", got "${manifest[field]}"`);
  }
}

function require_contains(field, value) {
  if (!Array.isArray(manifest[field]) || !manifest[field].includes(value)) {
    errors.push(`Field "${field}" must contain "${value}"`);
  }
}

// Required fields per acceptance criteria
require_field('name', 'TON Bridge — Bridge, Exchange, OTC');
require_field('short_name', 'TON Bridge');
require_field('id', '/?utm_source=pwa');
require_field('start_url', '/?utm_source=pwa');
require_field('display', 'standalone');
require_field('lang', 'en');
require_field('dir', 'ltr');

if (!manifest.description || typeof manifest.description !== 'string') {
  errors.push('Missing required field: "description"');
} else if (manifest.description.length > 150) {
  errors.push(`"description" must be ≤ 150 chars, got ${manifest.description.length}`);
}

require_contains('categories', 'finance');
require_contains('categories', 'utilities');

// Icons: 72→512 with maskable and monochrome at 512
const requiredSizes = ['72x72', '96x96', '128x128', '144x144', '152x152', '192x192', '384x384', '512x512'];
const icons = manifest.icons || [];
const iconSizes = icons.map(i => i.sizes);
for (const size of requiredSizes) {
  if (!iconSizes.includes(size)) errors.push(`Missing icon size: ${size}`);
}
if (!icons.some(i => i.purpose === 'maskable')) errors.push('Missing icon with purpose "maskable"');
if (!icons.some(i => i.purpose === 'monochrome')) errors.push('Missing icon with purpose "monochrome"');

// Screenshots: at least 3 narrow + 3 wide
const screenshots = manifest.screenshots || [];
const narrow = screenshots.filter(s => s.form_factor === 'narrow');
const wide = screenshots.filter(s => s.form_factor === 'wide');
if (narrow.length < 3) errors.push(`Need ≥3 narrow screenshots, got ${narrow.length}`);
if (wide.length < 3) errors.push(`Need ≥3 wide screenshots, got ${wide.length}`);

// Shortcuts: Bridge, Exchange, OTC
const shortcuts = manifest.shortcuts || [];
const shortcutNames = shortcuts.map(s => s.name);
for (const name of ['Bridge', 'Exchange', 'OTC']) {
  if (!shortcutNames.includes(name)) errors.push(`Missing shortcut: "${name}"`);
}

if (errors.length > 0) {
  console.error('❌ Manifest validation failed:');
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
} else {
  console.log('✅ __manifest.json is valid');
}
