#!/usr/bin/env node
// Fails if any locale JSON file drifts from the en.json key set.
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const i18nDir = join(root, 'src/i18n');

const localeFiles = readdirSync(i18nDir)
    .filter(file => file.endsWith('.json'))
    .sort();

if (!localeFiles.includes('en.json')) {
    console.error('Missing source locale: src/i18n/en.json');
    process.exit(1);
}

const source = JSON.parse(readFileSync(join(i18nDir, 'en.json'), 'utf8'));
const sourceKeys = new Set(Object.keys(source));
let hasError = false;

localeFiles.forEach(file => {
    if (file === 'en.json') return;

    const locale = JSON.parse(readFileSync(join(i18nDir, file), 'utf8'));
    const localeKeys = new Set(Object.keys(locale));
    const missing = [...sourceKeys].filter(k => !localeKeys.has(k));
    const extra = [...localeKeys].filter(k => !sourceKeys.has(k));

    if (missing.length > 0) {
        hasError = true;
        console.error(`Keys present in en.json but missing in ${file}:`);
        missing.forEach(k => console.error('  ' + k));
    }

    if (extra.length > 0) {
        hasError = true;
        console.error(`Keys present in ${file} but missing in en.json:`);
        extra.forEach(k => console.error('  ' + k));
    }
});

if (hasError) {
    process.exit(1);
}

console.log(`i18n key check passed: ${localeFiles.length} locale files match en.json`);
