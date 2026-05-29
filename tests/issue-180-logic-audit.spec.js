import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');
const i18nDir = resolve(rootDir, 'src', 'i18n');

async function waitForDist() {
  await expect.poll(() => existsSync(distDir), { timeout: 30000 }).toBe(true);
}

test.describe('Issue #180 — application logic audit', () => {
  test('no invalid </br> closing tags remain in built HTML (issue #178 spacing)', async () => {
    await waitForDist();
    const htmlFiles = readdirSync(distDir).filter((f) => f.endsWith('.html'));
    expect(htmlFiles.length).toBeGreaterThan(0);
    for (const file of htmlFiles) {
      const source = readFileSync(join(distDir, file), 'utf8');
      expect(source, `dist/${file} must not contain the invalid </br> closing tag`).not.toContain('</br>');
    }
  });

  test('offline indicator is localizable in every shell that renders it', async () => {
    await waitForDist();
    const htmlFiles = readdirSync(distDir).filter((f) => f.endsWith('.html'));
    for (const file of htmlFiles) {
      const source = readFileSync(join(distDir, file), 'utf8');
      const match = source.match(/<div\b[^>]*id="offline-indicator"[^>]*>/);
      if (!match) continue;
      expect(match[0], `dist/${file} offline indicator must carry data-i18n`).toContain('data-i18n="offline_indicator"');
    }
  });

  test('offline_indicator translation key exists in both locales', () => {
    const en = JSON.parse(readFileSync(join(i18nDir, 'en.json'), 'utf8'));
    const ru = JSON.parse(readFileSync(join(i18nDir, 'ru.json'), 'utf8'));
    expect(typeof en.offline_indicator).toBe('string');
    expect(en.offline_indicator.length).toBeGreaterThan(0);
    expect(typeof ru.offline_indicator).toBe('string');
    expect(ru.offline_indicator.length).toBeGreaterThan(0);
    // RU must actually be translated, not an English copy.
    expect(ru.offline_indicator).not.toBe(en.offline_indicator);
  });
});
