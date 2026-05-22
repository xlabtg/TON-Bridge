import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = resolve(__dirname, '..', 'dist');

const exchangePages = [
  'index.html',
  'index-ru.html',
  'index2.html',
  'index2-ru.html',
  'index3.html',
  'index3-ru.html',
];

async function waitForBuiltPage(page) {
  const file = join(distDir, page);
  const deadline = Date.now() + 30000;

  while (!existsSync(file)) {
    if (Date.now() > deadline) {
      throw new Error(`${page} was not built within 30 seconds`);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return readFileSync(file, 'utf8');
}

async function readRenderedPageVariants(page) {
  return [
    { label: page, source: readFileSync(join(rootDir, page), 'utf8') },
    { label: `dist/${page}`, source: await waitForBuiltPage(page) },
  ];
}

test.describe('Issue #152 page cleanup', () => {
  test('Bridge, Exchange and OTC pages do not render auxiliary progress or action blocks', async () => {
    for (const page of exchangePages) {
      for (const { label, source } of await readRenderedPageVariants(page)) {
        expect(source, `${label} should not render the tier progress wrapper`).not.toContain('tier-progress-wrap');
        expect(source, `${label} should not render the tier progress bar`).not.toContain('id="tier-progress-bar"');
        expect(source, `${label} should not render the page action stack`).not.toContain('exchange-action-stack');
        expect(source, `${label} should not render the send-to-chat button`).not.toContain('id="send-to-chat-btn"');
        expect(source, `${label} should not render the Ton App badge`).not.toContain('ton.app/a2/badge/topapp');
      }
    }
  });

  test('Bridge pages do not render social-proof markup after the intro copy', async () => {
    for (const page of ['index.html', 'index-ru.html']) {
      for (const { label, source } of await readRenderedPageVariants(page)) {
        expect(source, `${label} should not render the social proof pill`).not.toContain('id="social-proof-pill"');
        expect(source, `${label} should not render the social proof live region`).not.toContain('id="social-proof-region"');
        expect(source, `${label} should not load social-proof script`).not.toContain('assets/js/social-proof.js');
      }
    }
  });
});
