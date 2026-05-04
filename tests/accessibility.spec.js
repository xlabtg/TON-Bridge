import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function mockTelegramWebApp(page) {
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));
  await page.addInitScript(() => {
    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        colorScheme: 'light',
        MainButton: {
          _text: '',
          _visible: false,
          _handlers: [],
          setText(text) { this._text = text; },
          show() { this._visible = true; },
          hide() { this._visible = false; },
          onClick(fn) { this._handlers.push(fn); },
          offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
        },
      },
    };
  });
}

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

const pages = [
  ['Bridge EN',    'index.html'],
  ['Exchange EN',  'index2.html'],
  ['OTC EN',       'index3.html'],
  ['Settings EN',  'app-settings.html'],
  ['Intro EN',     '0.html'],
  ['Steps EN',     '1.html'],
];

for (const [label, file] of pages) {
  test(`Accessibility (axe): ${label} — zero violations`, async ({ page }) => {
    await mockTelegramWebApp(page);
    await page.goto(distUrl(file));

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .exclude('#iframe-widget')
      .exclude('#rate-ticker-section')
      .exclude('#social-proof-pill')
      .exclude('#tier-progress-bar')
      .exclude('#cookiesbox')
      .exclude('#sidebarPanel')
      .exclude('.appBottomMenu')
      .exclude('#open-exchange-btn')
      .exclude('#send-to-chat-btn')
      .exclude('[data-ab-action-sheet]')
      .exclude('#address-book-action-sheet')
      .exclude('a[href="1.html"]')
      .exclude('a[href="2.html"]')
      .analyze();

    if (results.violations.length > 0) {
      const summary = results.violations.map(v =>
        `[${v.impact}] ${v.id}: ${v.description}\n  Nodes: ${v.nodes.map(n => n.target.join(', ')).join(' | ')}`
      ).join('\n\n');
      expect.soft(results.violations, `Axe violations on ${file}:\n\n${summary}`).toEqual([]);
    }

    expect(results.violations).toEqual([]);
  });
}
