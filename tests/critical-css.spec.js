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

function readWebpDimensions(filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error(`${filePath} is not a WebP image`);
  }

  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkType = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (chunkType === 'VP8X') {
      return {
        width: 1 + buffer[dataOffset + 4] + (buffer[dataOffset + 5] << 8) + (buffer[dataOffset + 6] << 16),
        height: 1 + buffer[dataOffset + 7] + (buffer[dataOffset + 8] << 8) + (buffer[dataOffset + 9] << 16),
      };
    }

    if (chunkType === 'VP8L') {
      const bits = buffer[dataOffset + 1]
        | (buffer[dataOffset + 2] << 8)
        | (buffer[dataOffset + 3] << 16)
        | (buffer[dataOffset + 4] << 24);

      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }

    if (chunkType === 'VP8 ') {
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }

    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  throw new Error(`${filePath} has no supported WebP image chunk`);
}

function attrValue(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]+)"`));
  return match ? match[1] : '';
}

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
      expect(css).toContain('.intro-img');
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

  test('intro artwork declares dimensions matching the source image ratio', async () => {
    for (const page of ['index.html', 'index2.html']) {
      const source = readFileSync(join(distDir, page), 'utf8');
      const imgMatch = source.match(/<img\b[^>]*\bclass="[^"]*\bintro-img\b[^"]*"[^>]*>/);
      expect(imgMatch, `${page} should render intro artwork`).not.toBeNull();

      const tag = imgMatch[0];
      const src = attrValue(tag, 'src');
      const declaredWidth = Number(attrValue(tag, 'width'));
      const declaredHeight = Number(attrValue(tag, 'height'));
      const actual = readWebpDimensions(resolve(__dirname, '..', src));
      const expectedHeight = Math.round((declaredWidth * actual.height) / actual.width);

      expect(Number.isFinite(declaredWidth), `${page} intro image width should be numeric`).toBe(true);
      expect(Number.isFinite(declaredHeight), `${page} intro image height should be numeric`).toBe(true);
      expect(declaredHeight, `${page} intro image height should match ${actual.width}x${actual.height} ratio`).toBe(expectedHeight);
    }
  });
});
