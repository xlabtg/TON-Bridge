/**
 * Generates 1200×630 og:image PNGs for each page using Playwright.
 * Renders an HTML canvas template at 1200×630 and saves to assets/img/og/.
 * Run after build or as a standalone step:  node scripts/generate-og-images.js
 */

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function getBuildSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'latest';
  }
}

const en = JSON.parse(readFileSync(join(root, 'src/i18n/en.json'), 'utf8'));
const ru = JSON.parse(readFileSync(join(root, 'src/i18n/ru.json'), 'utf8'));

// Pages: [outputFile, title, subtitle, locale]
const pageSpecs = [
  [
    "index.png",
    "title_bridge",
    "Non-custodial - No registration",
    "en"
  ],
  [
    "index2.png",
    "title_exchange",
    "1200+ cryptocurrencies - 200 blockchains",
    "en"
  ],
  [
    "index3.png",
    "title_otc",
    "Fixed rate - Zero slippage",
    "en"
  ],
  [
    "0.png",
    "title_intro_bridge",
    "Get started with TON Bridge",
    "en"
  ],
  [
    "1.png",
    "title_intro_bridge_steps",
    "3 easy steps to bridge TON",
    "en"
  ],
  [
    "2.png",
    "title_intro_exchange_steps",
    "3 easy steps to exchange crypto",
    "en"
  ],
  [
    "app-settings.png",
    "title_settings",
    "Theme, language, security, notifications",
    "en"
  ],
  [
    "redeem.png",
    "title_redeem",
    "Convert TBC points into token payouts",
    "en"
  ],
  [
    "orders.png",
    "title_orders",
    "Track exchange order statuses",
    "en"
  ],
  [
    "index4.png",
    "title_statistics",
    "Volume, pairs, and bridge activity",
    "en"
  ],
  [
    "referral.png",
    "title_referral",
    "Earn TBC rewards for referrals",
    "en"
  ],
  [
    "privacy.png",
    "privacy_title",
    "Data, consent, analytics, and privacy",
    "en"
  ],
  [
    "index4-ru.png",
    "title_statistics",
    "Объем, пары и активность моста",
    "ru"
  ],
  [
    "orders-ru.png",
    "title_orders",
    "Отслеживайте статусы заказов",
    "ru"
  ],
  [
    "referral-ru.png",
    "title_referral",
    "Получайте TBC-награды за приглашения",
    "ru"
  ],
  [
    "privacy-ru.png",
    "privacy_title",
    "Данные, согласия, аналитика и приватность",
    "ru"
  ],
  [
    "redeem-ru.png",
    "title_redeem",
    "Обменивайте баллы TBC на выплаты токенами",
    "ru"
  ]
];
const pages = pageSpecs.map(([file, titleKey, subtitle, locale]) => [file, (locale === 'ru' ? ru : en)[titleKey], subtitle, locale]);

function buildHtml(title, subtitle, locale) {
  const isRu = locale === 'ru';
  const font = isRu
    ? "'Segoe UI', Arial, sans-serif"
    : "'Segoe UI', Arial, sans-serif";
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; overflow: hidden; }
  body {
    background: linear-gradient(135deg, #0f1724 0%, #1a2a4a 60%, #0d2137 100%);
    font-family: ${font};
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }
  .glow {
    position: absolute;
    width: 600px; height: 600px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(0,136,255,0.18) 0%, transparent 70%);
    top: -100px; right: -100px;
  }
  .content {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0 80px;
    z-index: 1;
    max-width: 850px;
  }
  .logo-row {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 40px;
  }
  .logo-img {
    width: 64px; height: 64px;
    border-radius: 14px;
  }
  .site-name {
    font-size: 28px;
    font-weight: 600;
    color: #a0c4ff;
    letter-spacing: 0.5px;
  }
  .title {
    font-size: 64px;
    font-weight: 700;
    color: #ffffff;
    line-height: 1.1;
    margin-bottom: 24px;
    letter-spacing: -1px;
  }
  .subtitle {
    font-size: 30px;
    color: #6ab4ff;
    font-weight: 400;
  }
  .ton-badge {
    position: absolute;
    bottom: 48px;
    right: 80px;
    font-size: 18px;
    color: rgba(255,255,255,0.35);
    font-weight: 500;
    letter-spacing: 1px;
  }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="content">
    <div class="logo-row">
      <img class="logo-img" src="data:image/png;base64,LOGO_BASE64" alt="TON Bridge">
      <span class="site-name">TON Bridge</span>
    </div>
    <div class="title">${title.replace(/↔/g, '↔')}</div>
    <div class="subtitle">${subtitle}</div>
  </div>
  <div class="ton-badge">tonbankcard.com</div>
</body>
</html>`;
}

async function main() {
  const outDir = join(root, 'assets/img/og');
  mkdirSync(outDir, { recursive: true });

  const logoPath = join(root, 'assets/img/icon/192x192.png');
  const logoBase64 = readFileSync(logoPath).toString('base64');

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 } });
  const page = await context.newPage();

  let generated = 0;
  for (const [file, title, subtitle, locale] of pages) {
    const html = buildHtml(title, subtitle, locale).replace('LOGO_BASE64', logoBase64);
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.screenshot({
      path: join(outDir, file),
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    generated++;
    process.stdout.write(`  Generated ${file}\n`);
  }

  await browser.close();
  process.stdout.write(`\nDone – ${generated} og:images written to assets/img/og/\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
