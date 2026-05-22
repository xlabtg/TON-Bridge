import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = resolve(__dirname, '..', 'dist');

const pageGroups = [
  {
    name: 'Bridge',
    pages: ['index.html', 'index-ru.html'],
    actionQueryKey: 'send_to_chat_query_bridge',
  },
  {
    name: 'Exchange',
    pages: ['index2.html', 'index2-ru.html'],
    actionQueryKey: 'send_to_chat_query_exchange',
  },
  {
    name: 'OTC',
    pages: ['index3.html', 'index3-ru.html'],
    actionQueryKey: 'send_to_chat_query_otc',
  },
];

async function waitForDistFile(file) {
  await expect.poll(() => existsSync(join(distDir, file)), { timeout: 30000 }).toBe(true);
}

async function readRenderedPageVariants(file) {
  await waitForDistFile(file);
  return [
    { label: file, source: readFileSync(join(rootDir, file), 'utf8') },
    { label: `dist/${file}`, source: readFileSync(join(distDir, file), 'utf8') },
  ];
}

test.describe('Issue #152 page cleanup', () => {
  for (const group of pageGroups) {
    test(`${group.name} pages remove only the requested visual elements`, async () => {
      for (const page of group.pages) {
        for (const { label, source } of await readRenderedPageVariants(page)) {
          expect(source, `${label} should not render the top tier progress wrapper`).not.toMatch(/<div\b[^>]*class="[^"]*\btier-progress-wrap\b/);
          expect(source, `${label} should not render the top tier progress bar`).not.toContain('id="tier-progress-bar"');
          expect(source, `${label} should not render the top illustration`).not.toMatch(/<img\b[^>]*class="[^"]*\b(?:intro-img|otc-img)\b/);
          expect(source, `${label} should not render the bridge social-proof element`).not.toContain('id="social-proof-pill"');
          expect(source, `${label} should keep the share/action stack`).toContain('exchange-action-stack');
          expect(source, `${label} should keep the Send to chat button`).toContain('id="send-to-chat-btn"');
          expect(source, `${label} should keep the page-specific send query`).toContain(group.actionQueryKey);
          expect(source, `${label} should keep the Cede badge`).toContain('ton.app/a2/badge/topapp');
        }
      }
    });
  }
});
