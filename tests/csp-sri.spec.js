import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distPath(file) {
  return resolve(__dirname, '..', 'dist', file);
}

function distUrl(file) {
  return 'file://' + distPath(file);
}

const pages = [
  'index.html',
  'index2.html',
  'index3.html',
  'index4.html',
  'index4-ru.html',
  '0.html',
  '1.html',
  '2.html',
  'orders.html',
  'orders-ru.html',
  'privacy.html',
  'privacy-ru.html',
  'referral.html',
  'referral-ru.html',
  'app-settings.html',
];

test.describe('CSP meta tag', () => {
  for (const file of pages) {
    test(`${file} has Content-Security-Policy-Report-Only meta`, ({ }) => {
      const html = readFileSync(distPath(file), 'utf8');
      expect(html).toContain('Content-Security-Policy-Report-Only');
      expect(html).toContain('report-uri /csp-report');
    });
  }
});

test.describe('SRI hashes on external scripts', () => {
  const TELEGRAM_SRI = 'sha384-1XuC9S4cgk6RH1oCsL2diDRwLiiivu/oZHNfxYUitEFuiKpP5ceNbzu220KKrcK+';
  const TGANALYTICS_SRI = 'sha384-njlroka3F7BclV9FXjiHDU9ZSrhSwNVRewye4d5rpWXYvery9PUnnhuAZAHfLyJ+';

  const pagesWithTelegram = [
    'index.html',
    'index2.html',
    'index3.html',
    'index4.html',
    'index4-ru.html',
    '0.html',
    '1.html',
    '2.html',
    'orders.html',
    'orders-ru.html',
  ];

  const pagesWithTgAnalytics = [
    'referral.html',
    'referral-ru.html',
  ];

  for (const file of pagesWithTelegram) {
    test(`${file} has SRI on telegram-web-app.js`, () => {
      const html = readFileSync(distPath(file), 'utf8');
      expect(html).toContain(TELEGRAM_SRI);
      expect(html).toContain('crossorigin="anonymous"');
    });
  }

  for (const file of pagesWithTgAnalytics) {
    test(`${file} has SRI on tganalytics.xyz/index.js`, () => {
      const html = readFileSync(distPath(file), 'utf8');
      expect(html).toContain(TGANALYTICS_SRI);
      expect(html).toContain('crossorigin="anonymous"');
    });
  }

  for (const file of pages) {
    test(`${file} uses self-hosted ionicons`, () => {
      const html = readFileSync(distPath(file), 'utf8');
      expect(html).toContain('src="assets/js/ion-icon.js"');
      expect(html).not.toContain('https://unpkg.com/ionicons');
    });
  }
});
