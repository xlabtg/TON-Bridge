import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

async function mockTelegramWebApp(page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));
  await page.addInitScript(() => {
    window.Telegram = {
      WebApp: {
        ready() {}, expand() {}, onEvent() {}, setHeaderColor() {},
        colorScheme: 'light',
        MainButton: { setText() {}, show() {}, hide() {}, onClick() {}, offClick() {} },
      },
    };
  });
}

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

function trackedAppFiles() {
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(file =>
      existsSync(resolve(repoRoot, file)) && (
        file.endsWith('.html') ||
        file === '__service-worker.js' ||
        (file.startsWith('assets/js/') && file.endsWith('.js')) ||
        (file.startsWith('assets/css/') && file.endsWith('.css')) ||
        (file.startsWith('assets/sass/') && file.endsWith('.scss')) ||
        (file.startsWith('src/') && file.endsWith('.njk'))
      )
    );
}

test.describe('Self-hosted ion-icon sprite', () => {
  test('Tracked app HTML and JS surfaces do not reference unpkg.com', async () => {
    const offenders = trackedAppFiles().filter(file =>
      readFileSync(resolve(repoRoot, file), 'utf8').includes('unpkg.com')
    );
    expect(offenders).toEqual([]);
  });

  test('SVG sprite contains every tracked ion-icon usage', async () => {
    const usedIcons = new Set();
    const iconRegex = /<ion-icon\b[^>]*\bname="([^"]+)"/g;

    for (const file of trackedAppFiles().filter(file => file.endsWith('.html') || file.endsWith('.njk'))) {
      const content = readFileSync(resolve(repoRoot, file), 'utf8');
      let match;
      while ((match = iconRegex.exec(content)) !== null) {
        usedIcons.add(match[1]);
      }
    }

    const sprite = readFileSync(resolve(repoRoot, 'assets/img/icons.svg'), 'utf8');
    const symbols = new Set(Array.from(sprite.matchAll(/<symbol\b[^>]*\bid="([^"]+)"/g), match => match[1]));
    const missing = Array.from(usedIcons).filter(icon => !symbols.has(icon));

    expect(missing).toEqual([]);
  });

  test('No unpkg.com ionicons script tags in built HTML', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    const unpkgScripts = await page.evaluate(() =>
      Array.from(document.scripts)
        .map(s => s.src)
        .filter(src => src.includes('unpkg.com') && src.includes('ionicons'))
    );
    expect(unpkgScripts).toHaveLength(0);
  });

  test('ion-icon custom element renders an SVG child', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    // Wait for custom element upgrade
    await page.waitForFunction(() =>
      customElements.get('ion-icon') !== undefined
    );
    const hasSvg = await page.evaluate(() => {
      const icon = document.querySelector('ion-icon');
      return icon !== null && icon.querySelector('svg') !== null;
    });
    expect(hasSvg).toBe(true);
  });

  test('ion-icon SVG use href points to local sprite', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('index.html'));
    await page.waitForFunction(() => customElements.get('ion-icon') !== undefined);
    const href = await page.evaluate(() => {
      const use = document.querySelector('ion-icon svg use');
      return use ? use.getAttribute('href') : null;
    });
    expect(href).toMatch(/^assets\/img\/icons\.svg#/);
  });

  test('Settings page: ion-icons render from local sprite', async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl('app-settings.html'));
    await page.waitForFunction(() => customElements.get('ion-icon') !== undefined);
    const count = await page.evaluate(() =>
      document.querySelectorAll('ion-icon svg').length
    );
    expect(count).toBeGreaterThan(0);
  });
});
