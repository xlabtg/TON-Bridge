import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname, join } from 'path';
import { readFileSync } from 'fs';

// Regression guard for issue #187 (follow-up to #122): the Bridge / Exchange /
// OTC pages must not ship any render-blocking external script. Every one of
// their <script src> tags is deferred, including the installer-generated public
// config (assets/js/tonbridge-config.js) which used to be the lone synchronous
// (render-blocking) resource left on these pages.
//
// The config script must also stay *before* assets/js/auth.js in document
// order: auth.js reads window.__TON_BRIDGE_CONFIG__ (workerBaseUrl) as soon as
// it runs, and deferred scripts execute in document order — so the config must
// be the first deferred script to keep the installer-provided worker URL.

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');

// Bridge (index/index2 → widget-page) and OTC (index3 → otc-page) are the
// pages Lighthouse audits in .lighthouserc.json. The other bottom-nav shells
// load the same deferred config via src/_includes/config-script.njk.
const auditedPages = ['index.html', 'index2.html', 'index3.html'];

const configShellPages = [
  ...auditedPages,
  'orders.html',
  'redeem.html',
  'referral.html',
  'app-settings.html',
  'index4.html', // statistics-page shell
];

function stripNoscript(html) {
  return html.replace(/<noscript[\s\S]*?<\/noscript>/g, '');
}

function externalScriptTags(html) {
  return stripNoscript(html).match(/<script\b[^>]*\bsrc=[^>]*><\/script>/g) || [];
}

test.describe('Issue #187 — no render-blocking scripts on Bridge/Exchange/OTC', () => {
  for (const page of auditedPages) {
    test(`${page}: every external script is deferred or async`, () => {
      const html = readFileSync(join(distDir, page), 'utf8');
      const tags = externalScriptTags(html);
      expect(tags.length).toBeGreaterThan(0);

      const blocking = tags.filter((tag) => !/\b(defer|async)\b/.test(tag));
      expect(blocking, `render-blocking <script src> tags in ${page}:\n${blocking.join('\n')}`).toEqual([]);
    });
  }

  for (const page of configShellPages) {
    test(`${page}: tonbridge-config.js is deferred and precedes auth.js`, () => {
      const html = readFileSync(join(distDir, page), 'utf8');

      const configTag = (html.match(/<script\b[^>]*\bsrc="assets\/js\/tonbridge-config\.js"[^>]*><\/script>/) || [])[0];
      expect(configTag, `${page} must load assets/js/tonbridge-config.js`).toBeTruthy();
      expect(configTag).toMatch(/\bdefer\b/);

      const configIndex = html.indexOf('assets/js/tonbridge-config.js');
      const authIndex = html.indexOf('assets/js/auth.js');
      if (authIndex !== -1) {
        expect(
          configIndex,
          `${page}: config must come before auth.js so window.__TON_BRIDGE_CONFIG__ is set first`,
        ).toBeLessThan(authIndex);
      }
    });
  }
});
