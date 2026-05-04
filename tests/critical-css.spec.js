import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname, join } from 'path';
import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');

const pages = [
  'index.html',
  'index2.html',
  'index3.html',
  'app-settings.html',
  '0.html',
  '1.html',
  '2.html',
];

const telegramThemePages = new Set([
  'index.html',
  'index2.html',
  'index3.html',
]);

test.describe('Critical CSS and deferred stylesheet', () => {
  for (const page of pages) {
    test(`${page}: has inline <style> with critical CSS`, async () => {
      const source = readFileSync(join(distDir, page), 'utf8');
      const match = source.match(/<style>([\s\S]*?)<\/style>/);
      expect(match).not.toBeNull();
      const css = match[1];
      expect(css.length).toBeGreaterThan(100);
      expect(css).toContain('#loader');
      expect(css).toContain('.appHeader');
      expect(css).toContain('#appCapsule');
      expect(css).toContain('.appBottomMenu');
    });

    test(`${page}: full stylesheet loaded via preload (not blocking <link>)`, async () => {
      const source = readFileSync(join(distDir, page), 'utf8');
      const withoutNoscript = source.replace(/<noscript[\s\S]*?<\/noscript>/g, '');

      expect(withoutNoscript).not.toMatch(/<link rel="stylesheet" href="assets\/css\/style\.css">/);
      expect(withoutNoscript).toMatch(/<link rel="preload" href="assets\/css\/style\.css" as="style" onload="this\.onload=null;this\.rel='stylesheet'">/);
      expect(source).toContain('<noscript>');
      expect(source).toContain('<link rel="stylesheet" href="assets/css/style.css">');
    });

    test(`${page}: Telegram theme stylesheet is only deferred where needed`, async () => {
      const source = readFileSync(join(distDir, page), 'utf8');
      const withoutNoscript = source.replace(/<noscript[\s\S]*?<\/noscript>/g, '');

      expect(withoutNoscript).not.toMatch(/<link rel="stylesheet" href="assets\/css\/tg-theme\.css">/);

      if (telegramThemePages.has(page)) {
        expect(withoutNoscript).toMatch(/<link rel="preload" href="assets\/css\/tg-theme\.css" as="style" onload="this\.onload=null;this\.rel='stylesheet'">/);
        expect(source).toContain('<link rel="stylesheet" href="assets/css/tg-theme.css">');
      } else {
        expect(source).not.toContain('assets/css/tg-theme.css');
      }
    });

    test(`${page}: has preconnect hints for all third-party origins`, async () => {
      const source = readFileSync(join(distDir, page), 'utf8');
      expect(source).toContain('rel="preconnect" href="https://changenow.io"');
      expect(source).toContain('rel="preconnect" href="https://widget-api.changenow.io"');
      expect(source).toContain('rel="preconnect" href="https://tganalytics.xyz"');
      expect(source).toContain('rel="preconnect" href="https://mc.yandex.ru"');
      expect(source).toContain('rel="preconnect" href="https://telegram.org"');
    });
  }

  test('Critical CSS is under 14 KB gzipped per page', async () => {
    for (const page of pages) {
      const source = readFileSync(join(distDir, page), 'utf8');
      const match = source.match(/<style>([\s\S]*?)<\/style>/);
      expect(match).not.toBeNull();
      expect(gzipSync(match[1]).length).toBeLessThan(14 * 1024);
    }
  });
});
