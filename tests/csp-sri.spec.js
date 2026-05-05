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

function repoPath(file) {
  return resolve(__dirname, '..', file);
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
  'program.html',
  'program-ru.html',
  'redeem.html',
  'redeem-ru.html',
  'referral.html',
  'referral-ru.html',
  'app-settings.html',
  'admin/index.html',
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
    'program.html',
    'program-ru.html',
    'redeem.html',
    'redeem-ru.html',
    'admin/index.html',
  ];

  const pagesWithTgAnalytics = [
    'redeem.html',
    'redeem-ru.html',
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
      expect(html).toMatch(/src="(?:\.\.\/)?assets\/js\/ion-icon\.js"/);
      expect(html).not.toContain('https://unpkg.com/ionicons');
    });
  }
});

test.describe('Analytics configuration is injected at build time', () => {
  const builtFiles = [
    'assets/js/base.js',
    'redeem.html',
    'redeem-ru.html',
    'referral.html',
    'referral-ru.html',
  ];

  const legacyAnalyticsToken = 'eyJhcHBfbmFtZSI6IlRPTkJyaWRnZV9yb2JvdCIsImFwcF91cmwiOiJodHRwczovL3QubWUvVE9OQnJpZGdlX3JvYm90IiwiYXBwX2RvbWFpbiI6Imh0dHBzOi8vdG9uYmFua2NhcmQuY29tL2JyaWRnZS9UTUEvMDAuaHRtbCJ9!PQ40y7Tz3lZti6uDVlApq+BcGxi8tR9WEsH6Hyu+mD0=';
  const sourceFiles = [
    'assets/js/base.js',
    'src/_includes/redeem-page.njk',
    'src/_includes/referral-page.njk',
  ];

  for (const file of builtFiles) {
    test(`${file} does not contain the legacy committed analytics token`, () => {
      const source = readFileSync(distPath(file), 'utf8');
      expect(source).not.toContain(legacyAnalyticsToken);
    });
  }

  for (const file of sourceFiles) {
    test(`${file} does not contain committed analytics credentials`, () => {
      const source = readFileSync(repoPath(file), 'utf8');
      expect(source).not.toContain(legacyAnalyticsToken);
      expect(source).not.toContain("appName: 'TONBridge_robot'");
      expect(source).not.toContain('appName: "TONBridge_robot"');
    });
  }

  test('base.js has build-time analytics placeholders replaced', () => {
    const source = readFileSync(distPath('assets/js/base.js'), 'utf8');
    expect(source).not.toContain('%%TG_ANALYTICS_TOKEN%%');
    expect(source).not.toContain('%%TG_ANALYTICS_APP_NAME%%');
    expect(source).not.toContain('%%YANDEX_METRIKA_ID%%');

    for (const configuredValue of [
      process.env.TG_ANALYTICS_TOKEN,
      process.env.TG_ANALYTICS_APP_NAME,
      process.env.YANDEX_METRIKA_ID,
    ]) {
      if (configuredValue) {
        expect(source).toContain(configuredValue);
      }
    }
  });
});
