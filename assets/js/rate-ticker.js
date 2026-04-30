/**
 * Rate Ticker — Task 3.1
 * Shows live spot prices for TON, USDT, BTC, ETH with 24h sparklines.
 * Data source: CoinGecko public API (no key required at low volume).
 * Cache: sessionStorage (60 s TTL) so tab switches don't re-fetch.
 * Refresh: every 60 s while foregrounded; paused when backgrounded.
 */
(function () {
  'use strict';

  const ASSETS = [
    { id: 'the-open-network', symbol: 'TON', label: 'TON',   bridgeFrom: 'ton',  icon: '💎' },
    { id: 'tether',           symbol: 'USDT', label: 'USDT', bridgeFrom: 'usdton', icon: '💵' },
    { id: 'bitcoin',          symbol: 'BTC',  label: 'BTC',  bridgeFrom: 'btc',  icon: '₿'  },
    { id: 'ethereum',         symbol: 'ETH',  label: 'ETH',  bridgeFrom: 'eth',  icon: 'Ξ'  },
  ];

  const CACHE_TTL = 60 * 1000; // 60 s
  const REFRESH_INTERVAL = 60 * 1000;
  const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

  let splideInstance = null;
  let chartInstances = {};
  let refreshTimer = null;
  let lastData = null; // keeps stale data on error

  // ── sessionStorage cache ────────────────────────────────────────────────────

  function cacheKey(name) { return 'rateTicker_' + name; }

  function cacheGet(name) {
    try {
      const raw = sessionStorage.getItem(cacheKey(name));
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts < CACHE_TTL) return data;
    } catch (_) {}
    return null;
  }

  function cacheSet(name, data) {
    try {
      sessionStorage.setItem(cacheKey(name), JSON.stringify({ ts: Date.now(), data }));
    } catch (_) {}
  }

  // ── CoinGecko fetch helpers ─────────────────────────────────────────────────

  async function fetchPrices() {
    const cached = cacheGet('prices');
    if (cached) return cached;

    const ids = ASSETS.map(a => a.id).join(',');
    const url = COINGECKO_BASE + '/simple/price?ids=' + ids + '&vs_currencies=usd&include_24hr_change=true';
    const res = await fetch(url);
    if (!res.ok) throw new Error('prices ' + res.status);
    const data = await res.json();
    cacheSet('prices', data);
    return data;
  }

  async function fetchSparkline(id) {
    const key = 'spark_' + id;
    const cached = cacheGet(key);
    if (cached) return cached;

    const url = COINGECKO_BASE + '/coins/' + id + '/market_chart?vs_currency=usd&days=1';
    const res = await fetch(url);
    if (!res.ok) throw new Error('sparkline ' + id + ' ' + res.status);
    const json = await res.json();
    // Take 24 evenly-spaced price points from the last 24h data
    const prices = json.prices.map(p => p[1]);
    const step = Math.max(1, Math.floor(prices.length / 24));
    const points = [];
    for (let i = 0; i < prices.length && points.length < 24; i += step) {
      points.push(+prices[i].toFixed(6));
    }
    cacheSet(key, points);
    return points;
  }

  // ── DOM skeleton ────────────────────────────────────────────────────────────

  function buildSkeleton() {
    const section = document.getElementById('rate-ticker-section');
    if (!section) return;

    const list = section.querySelector('.splide__list');
    if (!list) return;

    list.innerHTML = '';
    ASSETS.forEach(asset => {
      const li = document.createElement('li');
      li.className = 'splide__slide';
      li.dataset.asset = asset.id;
      li.innerHTML = `
        <div class="rate-card rate-card--loading">
          <div class="rate-card__header">
            <span class="rate-card__icon">${asset.icon}</span>
            <span class="rate-card__symbol">${asset.label}</span>
          </div>
          <div class="rate-card__price rate-card__skeleton">—</div>
          <div class="rate-card__change rate-card__skeleton">—</div>
          <div class="rate-card__chart" id="chart-${asset.symbol}"></div>
        </div>`;
      li.addEventListener('click', () => prefillBridge(asset));
      list.appendChild(li);
    });
  }

  // ── Splide init ─────────────────────────────────────────────────────────────

  function initCarousel() {
    const el = document.getElementById('rate-ticker-section');
    if (!el || !window.Splide) return;
    if (splideInstance) { splideInstance.destroy(); splideInstance = null; }

    splideInstance = new Splide(el, {
      type: 'loop',
      perPage: 2,
      gap: 12,
      padding: 16,
      arrows: false,
      pagination: false,
      rewind: true,
      breakpoints: {
        400: { perPage: 1 },
      },
    });
    splideInstance.mount();
  }

  // ── ApexCharts sparkline ────────────────────────────────────────────────────

  function renderSparkline(symbol, points, positive) {
    const el = document.getElementById('chart-' + symbol);
    if (!el || !window.ApexCharts) return;

    const color = positive ? '#1DCC70' : '#FF396F';

    if (chartInstances[symbol]) {
      chartInstances[symbol].updateSeries([{ data: points }]);
      return;
    }

    chartInstances[symbol] = new ApexCharts(el, {
      chart: {
        type: 'area',
        sparkline: { enabled: true },
        height: 40,
        animations: { enabled: false },
        toolbar: { show: false },
      },
      series: [{ data: points }],
      stroke: { curve: 'smooth', width: 1.5 },
      fill: {
        type: 'gradient',
        gradient: { opacityFrom: 0.4, opacityTo: 0 },
      },
      colors: [color],
      tooltip: { enabled: false },
    });
    chartInstances[symbol].render();
  }

  // ── Card update ─────────────────────────────────────────────────────────────

  function updateCard(asset, priceInfo, sparkPoints, stale) {
    // Avoid Splide clone slides (aria-hidden="true") by targeting the real slide only
    const slide = document.querySelector('.splide__slide:not(.splide__slide--clone)[data-asset="' + asset.id + '"]');
    if (!slide) return;

    const card = slide.querySelector('.rate-card');
    card.classList.remove('rate-card--loading');
    card.classList.toggle('rate-card--stale', !!stale);

    const priceEl = slide.querySelector('.rate-card__price');
    const changeEl = slide.querySelector('.rate-card__change');

    priceEl.classList.remove('rate-card__skeleton');
    changeEl.classList.remove('rate-card__skeleton');

    if (priceInfo) {
      const price = priceInfo.usd;
      const change = priceInfo.usd_24h_change;
      const positive = change >= 0;

      priceEl.textContent = '$' + formatPrice(price);
      changeEl.textContent = (positive ? '▲ +' : '▼ ') + change.toFixed(2) + '%';
      changeEl.className = 'rate-card__change ' + (positive ? 'text-success' : 'text-danger');

      if (sparkPoints && sparkPoints.length > 0) {
        renderSparkline(asset.symbol, sparkPoints, positive);
      }
    }

    if (stale) {
      let staleEl = slide.querySelector('.rate-card__stale');
      if (!staleEl) {
        staleEl = document.createElement('span');
        staleEl.className = 'rate-card__stale';
        staleEl.title = 'Data may be outdated';
        staleEl.textContent = '·';
        card.appendChild(staleEl);
      }
    } else {
      const staleEl = slide.querySelector('.rate-card__stale');
      if (staleEl) staleEl.remove();
    }
  }

  function formatPrice(price) {
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(2);
    return price.toPrecision(4);
  }

  // ── Bridge pre-fill ─────────────────────────────────────────────────────────

  function prefillBridge(asset) {
    const iframe = document.getElementById('iframe-widget');
    if (!iframe) return;
    try {
      const url = new URL(iframe.src);
      url.searchParams.set('from', asset.bridgeFrom);
      iframe.src = url.toString();
    } catch (_) {}
  }

  // ── Data refresh ────────────────────────────────────────────────────────────

  async function refresh() {
    let stale = false;
    let prices;

    try {
      prices = await fetchPrices();
      lastData = { prices };
    } catch (_) {
      stale = true;
      if (lastData) {
        prices = lastData.prices;
      } else {
        return; // no data at all yet — stay on skeleton
      }
    }

    for (const asset of ASSETS) {
      let sparkPoints = null;
      try {
        sparkPoints = await fetchSparkline(asset.id);
      } catch (_) {
        // chart stays blank on error
      }
      updateCard(asset, prices[asset.id], sparkPoints, stale);
    }
  }

  // ── Visibility-aware scheduler ──────────────────────────────────────────────

  function startRefreshLoop() {
    stopRefreshLoop();
    refresh();
    refreshTimer = setInterval(() => {
      if (!document.hidden) refresh();
    }, REFRESH_INTERVAL);
  }

  function stopRefreshLoop() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }

  // ── Bootstrap ───────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    buildSkeleton();
    initCarousel();
    startRefreshLoop();

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopRefreshLoop();
      } else {
        startRefreshLoop();
      }
    });
  });

})();
