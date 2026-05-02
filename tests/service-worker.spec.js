import { test, expect } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');

function toUrlPath(filePath) {
  return relative(distDir, filePath).split(sep).join('/');
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    return statSync(fullPath).isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function shouldPrecache(url) {
  if (url === '__service-worker.js') return false;
  if (url === '__manifest.json') return true;
  return (
    url.endsWith('.html') ||
    url.startsWith('assets/css/') && url.endsWith('.css') ||
    url.startsWith('assets/js/') && url.endsWith('.js') ||
    url.startsWith('assets/img/') && /\.(png|jpe?g|svg|webp|ico)$/i.test(url) ||
    url.startsWith('assets/fonts/') && /\.(woff2?|ttf|otf)$/i.test(url)
  );
}

function readPrecacheUrls() {
  const sw = readFileSync(join(distDir, '__service-worker.js'), 'utf8');
  const match = sw.match(/var PRECACHE_URLS = \[([\s\S]*?)\];/);
  expect(match, 'PRECACHE_URLS array should be emitted into the built service worker').not.toBeNull();
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]);
}

test.describe('service worker precache manifest', () => {
  test('does not reference files missing from dist', () => {
    const missing = readPrecacheUrls().filter((url) => !existsSync(join(distDir, url)));

    expect(missing).toEqual([]);
  });

  test('includes every generated offline-critical static asset', () => {
    const precache = new Set(readPrecacheUrls());
    const expected = walk(distDir).map(toUrlPath).filter(shouldPrecache);
    const missing = expected.filter((url) => !precache.has(url));

    expect(missing).toEqual([]);
  });
});
