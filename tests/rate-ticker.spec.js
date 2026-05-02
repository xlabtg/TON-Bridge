import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function distUrl(file) {
  return 'file://' + resolve(__dirname, '..', 'dist', file);
}

async function setLangPref(page, lang) {
  await page.addInitScript((l) => {
    localStorage.setItem('pref:lang', l);
  }, lang);
}

async function disableIdlePreload(page) {
  await page.addInitScript(() => {
    window.requestIdleCallback = function() { return 0; };
    const origSetTimeout = window.setTimeout;
    window.setTimeout = function(fn, delay, ...args) {
      if (delay === 2000) return 0;
      return origSetTimeout(fn, delay, ...args);
    };
  });
}

function iframeParam(page, name) {
  return page.locator('#iframe-widget').evaluate((iframe, paramName) => {
    return new URL(iframe.src).searchParams.get(paramName);
  }, name);
}

async function mockTelegramAndCoinGecko(page) {
  const apiState = { failPrices: false };

  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* mocked */',
  }));

  await page.addInitScript(() => {
    const mainButton = {
      _text: '',
      _visible: false,
      _handlers: [],
      setText(t) { this._text = t; },
      show() { this._visible = true; },
      hide() { this._visible = false; },
      onClick(fn) { this._handlers.push(fn); },
      offClick(fn) { this._handlers = this._handlers.filter(h => h !== fn); },
    };

    window.Telegram = {
      WebApp: {
        ready() {},
        expand() {},
        onEvent() {},
        setHeaderColor() {},
        openTelegramLink() {},
        colorScheme: 'light',
        themeParams: {},
        MainButton: mainButton,
        initDataUnsafe: {},
      },
    };
  });

  await page.route('https://api.coingecko.com/api/v3/simple/price*', route => {
    if (apiState.failPrices) {
      return route.fulfill({ status: 500, body: 'error' });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        'the-open-network': { usd: 5.12, usd_24h_change: 2.34 },
        'tether': { usd: 1.00, usd_24h_change: -0.01 },
        'bitcoin': { usd: 62000, usd_24h_change: -1.5 },
        'ethereum': { usd: 3200, usd_24h_change: 0.75 },
      }),
    });
  });

  const sparkBody = JSON.stringify({
    prices: Array.from({ length: 24 }, (_, i) => [Date.now() - i * 3600000, 5 + i / 100]),
  });
  await page.route('https://api.coingecko.com/api/v3/coins/*/market_chart*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: sparkBody,
  }));

  return apiState;
}

async function waitForTickerData(page) {
  await expect(page.locator('.splide__slide:not(.splide__slide--clone)[data-asset="the-open-network"] .rate-card__price'))
    .not.toHaveText('—', { timeout: 5000 });
}

test.describe('Rate Ticker - Task 3.1', () => {
  test('Rate ticker section is present on the Bridge page', async ({ page }) => {
    await mockTelegramAndCoinGecko(page);
    await page.goto(distUrl('index.html'));
    await expect(page.locator('#rate-ticker-section')).toBeVisible();
  });

  test('Rate ticker aria label follows runtime i18n', async ({ page }) => {
    await mockTelegramAndCoinGecko(page);
    await setLangPref(page, 'ru');
    await page.goto(distUrl('index.html'));

    await page.waitForFunction(() => document.documentElement.lang === 'ru');
    await expect(page.locator('#rate-ticker-section')).toHaveAttribute('aria-label', 'Тикер курсов активов');
  });

  test('Ticker renders 4 asset cards (TON, USDT, BTC, ETH)', async ({ page }) => {
    await mockTelegramAndCoinGecko(page);
    await page.goto(distUrl('index.html'));

    const realSlides = page.locator('.splide__slide:not(.splide__slide--clone) .rate-card');
    await expect(realSlides).toHaveCount(4);

    const symbols = await page.locator('.splide__slide:not(.splide__slide--clone) .rate-card__symbol').allTextContents();
    expect(symbols).toEqual(expect.arrayContaining(['TON', 'USDT', 'BTC', 'ETH']));
  });

  test('Ticker shows live price data after fetch', async ({ page }) => {
    await mockTelegramAndCoinGecko(page);
    await page.goto(distUrl('index.html'));

    const tonSlide = page.locator('.splide__slide:not(.splide__slide--clone)[data-asset="the-open-network"]');
    const priceEl = tonSlide.locator('.rate-card__price');

    await expect(priceEl).not.toHaveText('—', { timeout: 5000 });
    await expect(priceEl).toHaveText('$5.12');
  });

  test('Positive 24h change shows green class', async ({ page }) => {
    await mockTelegramAndCoinGecko(page);
    await page.goto(distUrl('index.html'));

    const changeEl = page.locator('.splide__slide:not(.splide__slide--clone)[data-asset="the-open-network"] .rate-card__change');

    await expect(changeEl).not.toHaveText('—', { timeout: 5000 });
    await expect(changeEl).toHaveClass(/text-success/);
  });

  test('Negative 24h change shows red class', async ({ page }) => {
    await mockTelegramAndCoinGecko(page);
    await page.goto(distUrl('index.html'));

    const changeEl = page.locator('.splide__slide:not(.splide__slide--clone)[data-asset="bitcoin"] .rate-card__change');

    await expect(changeEl).not.toHaveText('—', { timeout: 5000 });
    await expect(changeEl).toHaveClass(/text-danger/);
  });

  test('Stale indicator appears and keeps previous prices when API fails after a successful fetch', async ({ page }) => {
    const apiState = await mockTelegramAndCoinGecko(page);
    await page.goto(distUrl('index.html'));
    await waitForTickerData(page);

    apiState.failPrices = true;
    await page.evaluate(() => {
      Object.keys(sessionStorage).forEach(k => {
        if (k.startsWith('rateTicker_')) sessionStorage.removeItem(k);
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    const tonSlide = page.locator('.splide__slide:not(.splide__slide--clone)[data-asset="the-open-network"]');
    await expect(tonSlide.locator('.rate-card__price')).toHaveText('$5.12');
    await expect(tonSlide.locator('.rate-card__stale')).toBeVisible();
  });

  test('Clicking a card stores the Bridge from asset before the lazy iframe is opened', async ({ page }) => {
    await mockTelegramAndCoinGecko(page);
    await disableIdlePreload(page);
    await page.goto(distUrl('index.html'));
    await waitForTickerData(page);

    await expect(page.locator('#iframe-widget')).toHaveCount(0);
    await page.locator('.splide__slide:not(.splide__slide--clone)[data-asset="bitcoin"] .rate-card').click();
    await page.locator('#open-exchange-btn').click();

    await expect(page.locator('#iframe-widget')).toHaveCount(1);
    await expect.poll(() => iframeParam(page, 'from')).toBe('btc');
  });

  test('Clicking a card updates an already injected Bridge iframe src', async ({ page }) => {
    await mockTelegramAndCoinGecko(page);
    await disableIdlePreload(page);
    await page.goto(distUrl('index.html'));
    await waitForTickerData(page);

    await page.locator('#open-exchange-btn').click();
    await expect.poll(() => iframeParam(page, 'from')).toBe('ton');

    const usdtCard = page.locator('.splide__slide:not(.splide__slide--clone)[data-asset="tether"] .rate-card');
    await usdtCard.scrollIntoViewIfNeeded();
    await expect(usdtCard).toBeVisible();
    await usdtCard.click();
    await expect.poll(() => iframeParam(page, 'from')).toBe('usdton');
  });

  test('Screenshot: Rate ticker visible on Bridge EN', async ({ page }) => {
    await mockTelegramAndCoinGecko(page);
    await page.goto(distUrl('index.html'));
    await waitForTickerData(page);
    await page.screenshot({ path: 'tests/screenshots/rate-ticker-en.png', fullPage: false });
  });

  test('Screenshot: Rate ticker visible on Bridge RU', async ({ page }) => {
    await mockTelegramAndCoinGecko(page);
    await setLangPref(page, 'ru');
    await page.goto(distUrl('index.html'));
    await page.waitForFunction(() => document.documentElement.lang === 'ru');
    await waitForTickerData(page);
    await page.screenshot({ path: 'tests/screenshots/rate-ticker-ru.png', fullPage: false });
  });
});
