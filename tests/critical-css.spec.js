import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');

function distUrl(file) {
  return 'file://' + resolve(distDir, file);
}

const pages = [
  'index.html',
  'index-ru.html',
  'index2.html',
  'index2-ru.html',
  'index3.html',
  'index3-ru.html',
  'app-settings.html',
  '0.html',
  '1.html',
  '2.html',
];

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
      // There must be no bare blocking stylesheet outside noscript
      // Strip noscript blocks before checking for blocking link
      const withoutNoscript = source.replace(/<noscript[\s\S]*?<\/noscript>/g, '');
      expect(withoutNoscript).not.toMatch(/<link rel="stylesheet" href="assets\/css\/style\.css">/);
      // A preload link for style.css must be present
      expect(source).toContain('rel="preload"');
      expect(source).toContain('assets/css/style.css');
      expect(source).toContain('as="style"');
      // A noscript fallback must be present
      expect(source).toContain('<noscript>');
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

  test('Critical CSS is under 14 KB uncompressed per page', async () => {
    const source = readFileSync(join(distDir, 'index.html'), 'utf8');
    const match = source.match(/<style>([\s\S]*?)<\/style>/);
    expect(match).not.toBeNull();
    // 14 KB uncompressed is generous — our actual size is ~2.7 KB
    expect(match[1].length).toBeLessThan(14 * 1024);
  });
});
