/**
 * Rate Ticker - Task 3.1
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
  const TAP_MOVE_LIMIT = 8;

  let splideInstance = null;
  let refreshTimer = null;
  let lastData = null;

  // sessionStorage cache

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

  // CoinGecko fetch helpers

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

  // DOM skeleton

  function buildSkeleton() {
    const section = document.getElementById('rate-ticker-section');
    if (!section) return;

    const list = section.querySelector('.splide__list');
    if (!list) return;

    const existingSlides = Array.from(list.querySelectorAll('.splide__slide[data-asset]'));
    if (existingSlides.length === ASSETS.length) {
      ASSETS.forEach(asset => {
        const slide = existingSlides.find(item => item.dataset.asset === asset.id);
        if (slide) bindCardTap(slide.querySelector('.rate-card'), asset);
      });
      return;
    }

    list.innerHTML = '';
    ASSETS.forEach(asset => {
      const li = document.createElement('li');
      li.className = 'splide__slide';
      li.dataset.asset = asset.id;
      li.innerHTML = `
        <button type="button" class="rate-card rate-card--loading">
          <div class="rate-card__header">
            <span class="rate-card__icon">${asset.icon}</span>
            <span class="rate-card__symbol">${asset.label}</span>
          </div>
          <div class="rate-card__price rate-card__skeleton">—</div>
          <div class="rate-card__change rate-card__skeleton">—</div>
          <div class="rate-card__chart" id="chart-${asset.symbol}"></div>
        </button>`;
      bindCardTap(li.querySelector('.rate-card'), asset);
      list.appendChild(li);
    });
  }

  function bindCardTap(card, asset) {
    if (!card) return;

    let pointerStart = null;

    card.addEventListener('pointerdown', event => {
      if (event.button && event.button !== 0) return;
      pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    });

    card.addEventListener('pointerup', event => {
      if (!pointerStart || pointerStart.id !== event.pointerId) return;

      const movedX = Math.abs(event.clientX - pointerStart.x);
      const movedY = Math.abs(event.clientY - pointerStart.y);
      pointerStart = null;

      if (movedX <= TAP_MOVE_LIMIT && movedY <= TAP_MOVE_LIMIT) {
        prefillBridge(asset);
      }
    });

    card.addEventListener('pointercancel', () => {
      pointerStart = null;
    });

    card.addEventListener('click', event => {
      if (!window.PointerEvent || event.detail === 0) {
        prefillBridge(asset);
      }
    });
  }

  // Splide init

  function initCarousel() {
    const el = document.getElementById('rate-ticker-section');
    if (!el || !window.Splide) return;
    if (splideInstance) { splideInstance.destroy(); splideInstance = null; }

    splideInstance = new Splide(el, {
      type: 'slide',
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

    el.querySelectorAll('.splide__sr').forEach(label => {
      label.setAttribute('aria-hidden', 'true');
    });
  }

  // Inline SVG sparkline — drop-in replacement for ApexCharts to eliminate
  // ~100 KB of legacy ES5 polyfills shipped by the old apexcharts.min.js bundle.

  const SPARK_WIDTH = 100;
  const SPARK_HEIGHT = 40;
  const SPARK_PAD_Y = 2;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function sparkPath(points) {
    if (!points || points.length < 2) return { line: '', area: '' };

    let min = points[0];
    let max = points[0];
    for (let i = 1; i < points.length; i++) {
      if (points[i] < min) min = points[i];
      if (points[i] > max) max = points[i];
    }
    const range = max - min || 1;
    const stepX = SPARK_WIDTH / (points.length - 1);
    const innerH = SPARK_HEIGHT - SPARK_PAD_Y * 2;

    const coords = points.map((v, i) => {
      const x = i * stepX;
      const y = SPARK_PAD_Y + innerH - ((v - min) / range) * innerH;
      return { x, y };
    });

    // Smooth curve via Catmull-Rom-to-Bezier conversion.
    let line = 'M' + coords[0].x.toFixed(2) + ',' + coords[0].y.toFixed(2);
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i - 1] || coords[i];
      const p1 = coords[i];
      const p2 = coords[i + 1];
      const p3 = coords[i + 2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      line += ' C' + c1x.toFixed(2) + ',' + c1y.toFixed(2) +
              ' ' + c2x.toFixed(2) + ',' + c2y.toFixed(2) +
              ' ' + p2.x.toFixed(2) + ',' + p2.y.toFixed(2);
    }
    const area = line + ' L' + SPARK_WIDTH.toFixed(2) + ',' + SPARK_HEIGHT.toFixed(2) +
                 ' L0,' + SPARK_HEIGHT.toFixed(2) + ' Z';
    return { line, area };
  }

  function renderSparkline(symbol, points, positive) {
    const el = document.getElementById('chart-' + symbol);
    if (!el) return;

    const color = positive ? '#1DCC70' : '#FF396F';
    const gradId = 'sparkgrad-' + symbol;
    const { line, area } = sparkPath(points);
    if (!line) return;

    let svg = el.querySelector('svg');
    if (!svg) {
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + SPARK_WIDTH + ' ' + SPARK_HEIGHT);
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.style.display = 'block';

      const defs = document.createElementNS(SVG_NS, 'defs');
      const grad = document.createElementNS(SVG_NS, 'linearGradient');
      grad.setAttribute('id', gradId);
      grad.setAttribute('x1', '0');
      grad.setAttribute('y1', '0');
      grad.setAttribute('x2', '0');
      grad.setAttribute('y2', '1');
      const stop1 = document.createElementNS(SVG_NS, 'stop');
      stop1.setAttribute('offset', '0%');
      stop1.setAttribute('stop-color', color);
      stop1.setAttribute('stop-opacity', '0.4');
      const stop2 = document.createElementNS(SVG_NS, 'stop');
      stop2.setAttribute('offset', '100%');
      stop2.setAttribute('stop-color', color);
      stop2.setAttribute('stop-opacity', '0');
      grad.appendChild(stop1);
      grad.appendChild(stop2);
      defs.appendChild(grad);
      svg.appendChild(defs);

      const areaPath = document.createElementNS(SVG_NS, 'path');
      areaPath.setAttribute('class', 'rate-spark__area');
      areaPath.setAttribute('fill', 'url(#' + gradId + ')');
      areaPath.setAttribute('stroke', 'none');
      svg.appendChild(areaPath);

      const linePath = document.createElementNS(SVG_NS, 'path');
      linePath.setAttribute('class', 'rate-spark__line');
      linePath.setAttribute('fill', 'none');
      linePath.setAttribute('stroke-width', '1.5');
      linePath.setAttribute('stroke-linecap', 'round');
      linePath.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(linePath);

      el.appendChild(svg);
      el.setAttribute('aria-hidden', 'true');
    }

    const stops = svg.querySelectorAll('stop');
    if (stops[0]) stops[0].setAttribute('stop-color', color);
    if (stops[1]) stops[1].setAttribute('stop-color', color);

    const areaPath = svg.querySelector('.rate-spark__area');
    const linePath = svg.querySelector('.rate-spark__line');
    if (areaPath) areaPath.setAttribute('d', area);
    if (linePath) {
      linePath.setAttribute('d', line);
      linePath.setAttribute('stroke', color);
    }
  }

  // Card update

  function updateCard(asset, priceInfo, sparkPoints, stale) {
    const slide = document.querySelector('.splide__slide[data-asset="' + asset.id + '"]');
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
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Bridge pre-fill

  function prefillBridge(asset) {
    if (typeof window.setExchangeWidgetFrom === 'function') {
      window.setExchangeWidgetFrom(asset.bridgeFrom);
      return;
    }

    const iframe = document.getElementById('iframe-widget');
    if (!iframe) return;
    try {
      const url = new URL(iframe.src);
      url.searchParams.set('from', asset.bridgeFrom);
      iframe.src = url.toString();
    } catch (_) {}
  }

  // Data refresh

  async function refresh() {
    let stale = false;
    let prices;
    const sparklines = {};

    try {
      prices = await fetchPrices();
    } catch (_) {
      stale = true;
      if (lastData) {
        prices = lastData.prices;
      } else {
        return; // no data at all yet; stay on skeleton
      }
    }

    const updates = [];
    for (const asset of ASSETS) {
      let sparkPoints = null;
      try {
        sparkPoints = await fetchSparkline(asset.id);
        sparklines[asset.id] = sparkPoints;
      } catch (_) {
        stale = true;
        if (lastData && lastData.sparklines) {
          sparkPoints = lastData.sparklines[asset.id] || null;
        }
      }
      updates.push({ asset, priceInfo: prices[asset.id], sparkPoints });
    }

    updates.forEach(update => {
      updateCard(update.asset, update.priceInfo, update.sparkPoints, stale);
    });

    if (!stale || !lastData) {
      lastData = { prices, sparklines };
    } else {
      lastData = {
        prices,
        sparklines: Object.assign({}, lastData.sparklines || {}, sparklines),
      };
    }
  }

  // Visibility-aware scheduler

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

  // Bootstrap

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
