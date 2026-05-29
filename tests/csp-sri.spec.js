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
    test(`${file} ships an enforced Content-Security-Policy meta`, ({ }) => {
      const html = readFileSync(distPath(file), 'utf8');
      // Issue #117: CSP must be enforced (Report-Only is silently ignored
      // inside <meta>, per the W3C CSP3 spec and MDN).
      expect(html).toMatch(/<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]+"\s*\/?>/i);
      expect(html).not.toContain('Content-Security-Policy-Report-Only');
      // report-uri / report-to are no-ops inside <meta>; they must not be shipped.
      expect(html).not.toMatch(/<meta[^>]*Content-Security-Policy[^>]*report-uri/i);
      expect(html).not.toMatch(/<meta[^>]*Content-Security-Policy[^>]*report-to/i);
      // Issue #185: cdn.jsdelivr.net was a dead allowance (Chart.js is now
      // self-hosted, #119). It must not reappear in any page policy.
      expect(html).not.toContain('cdn.jsdelivr.net');
    });
  }
});

test.describe('CSP HTTP header (.htaccess)', () => {
  // Issue #185: `frame-ancestors` (clickjacking) and `report-uri` are silently
  // ignored inside <meta> and only take effect from an HTTP response header, so
  // the policy is also delivered from .htaccess (passthrough-copied to dist/).
  const htaccess = readFileSync(distPath('.htaccess'), 'utf8');

  test('.htaccess sets a Content-Security-Policy response header', () => {
    expect(htaccess).toMatch(/Header set Content-Security-Policy\s+"[^"]+"/);
  });

  test('header policy enforces frame-ancestors and still allows Telegram Web embedding', () => {
    const match = htaccess.match(/Header set Content-Security-Policy\s+"([^"]+)"/);
    expect(match, '.htaccess must declare a Content-Security-Policy header').toBeTruthy();
    const policy = match[1];
    expect(policy).toContain('frame-ancestors');
    // Telegram embeds Mini Apps in an <iframe> on Telegram Web/Desktop; native
    // clients use a WebView that ignores frame-ancestors. Dropping this origin
    // would break the app on Telegram Web.
    expect(policy).toContain('https://web.telegram.org');
    // The dead CDN allowance must not sneak back in via the header either.
    expect(policy).not.toContain('cdn.jsdelivr.net');
  });
});

test.describe('Admin CSP connect-src allows the worker origin', () => {
  // Issue #174: the admin panel fetches every dataset from the cross-origin
  // Cloudflare Worker (assets/js/admin.js → worker/src/adminPanel.js). If the
  // worker origin is missing from connect-src the browser blocks all
  // /admin/api/* requests and the panel renders no data — which is exactly what
  // made the #172/#173 data-loading fix look like it had no effect once
  // deployed. The other worker-backed pages already list the origin; the admin
  // page must too. (The admin.spec.js suite patches window.fetch before the page
  // scripts run, so it cannot catch a CSP regression — this static check does.)
  test('admin/index.html lists the worker origin in connect-src', () => {
    const html = readFileSync(distPath('admin/index.html'), 'utf8');
    const match = html.match(/connect-src([^;"]*)/);
    expect(match, 'admin page must declare a connect-src directive').toBeTruthy();
    expect(match[1]).toContain('https://ton-bridge-worker.tonbankcard.workers.dev');
  });
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

  // Issue #119: statistics-page.njk previously loaded Chart.js from
  // cdn.jsdelivr.net without integrity=. It's now bundled locally so SRI is
  // moot — but we want a guardrail that no Chart.js CDN URL sneaks back in,
  // and that the self-hosted script is what the page references.
  const statisticsPages = ['index4.html', 'index4-ru.html'];
  for (const file of statisticsPages) {
    test(`${file} loads Chart.js from a self-hosted path`, () => {
      const html = readFileSync(distPath(file), 'utf8');
      expect(html).toContain('assets/js/lib/chart.umd.min.js');
      expect(html).not.toMatch(/<script[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js/);
      expect(html).not.toMatch(/<script[^>]*src="https?:\/\/[^"]*chart(?:\.umd)?(?:\.min)?\.js"/);
    });
  }

  test('self-hosted Chart.js is shipped in dist/', () => {
    const html = readFileSync(distPath('assets/js/lib/chart.umd.min.js'), 'utf8');
    // Sanity check that the file is a real Chart.js bundle, not an empty
    // placeholder.
    expect(html).toContain('Chart.js');
  });
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
