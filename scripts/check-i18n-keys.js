#!/usr/bin/env node
// Fails if any key in en.json is missing from ru.json or vice versa.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const en = JSON.parse(readFileSync(join(root, 'src/i18n/en.json'), 'utf8'));
const ru = JSON.parse(readFileSync(join(root, 'src/i18n/ru.json'), 'utf8'));

const enKeys = new Set(Object.keys(en));
const ruKeys = new Set(Object.keys(ru));

const missingInRu = [...enKeys].filter(k => !ruKeys.has(k));
const missingInEn = [...ruKeys].filter(k => !enKeys.has(k));

if (missingInRu.length > 0) {
    console.error('Keys present in en.json but missing in ru.json:');
    missingInRu.forEach(k => console.error('  ' + k));
}
if (missingInEn.length > 0) {
    console.error('Keys present in ru.json but missing in en.json:');
    missingInEn.forEach(k => console.error('  ' + k));
}

if (missingInRu.length > 0 || missingInEn.length > 0) {
    process.exit(1);
}

console.log('i18n key check passed: all keys match between en.json and ru.json');
