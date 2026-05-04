/**
 * USD Turnover Oracle (issue #47)
 *
 * usdValue({ symbol, amount, atUnixSec }) → { usd: number, source: string } | null
 *
 * Source priority:
 *   1. ChangeNOW partner endpoint (if the swap carries a USD value)
 *   2. CoinGecko /coins/{id}/history?date=DD-MM-YYYY (daily granularity, free tier)
 *   3. Manual fallback table refreshed daily
 *
 * Stablecoins (USDT, USDC, USDT-TON, USDT-TRC20, USDC-ERC20) return 1.000 without
 * hitting any API.
 */

// ---------------------------------------------------------------------------
// Symbol maps
// ---------------------------------------------------------------------------

/** Symbols whose USD value is always 1.000 — no oracle call needed. */
const STABLECOINS = new Set([
  'USDT', 'USDC', 'USDT-TON', 'USDT-TRC20', 'USDT-ERC20',
  'USDC-ERC20', 'USDC-SOL', 'DAI', 'BUSD',
]);

/**
 * ChangeNOW ticker → CoinGecko coin id.
 * Add entries here whenever a new asset needs oracle support.
 */
const SYMBOL_TO_COINGECKO_ID = {
  'TON':        'the-open-network',
  'TON-BSC':    'the-open-network',
  'BTC':        'bitcoin',
  'BTC-TON':    'bitcoin',
  'ETH':        'ethereum',
  'ETH-BSC':    'ethereum',
  'BNB':        'binancecoin',
  'SOL':        'solana',
  'TRX':        'tron',
  'MATIC':      'matic-network',
  'AVAX':       'avalanche-2',
  'LTC':        'litecoin',
  'XRP':        'ripple',
  'DOT':        'polkadot',
  'ADA':        'cardano',
  'DOGE':       'dogecoin',
};

// ---------------------------------------------------------------------------
// Runtime KV cache
// ---------------------------------------------------------------------------

/**
 * A simple in-process Map used as a 60-second runtime cache.
 * For historical lookups (accrual job re-runs) the cache key includes the
 * swap date, so older results are reused without a fresh API hit.
 *
 * In a Cloudflare Worker environment this can be swapped for `env.KV`.
 */
const _cache = new Map();

/** @type {() => number} — injectable for testing */
let _nowMs = () => Date.now();

const CACHE_TTL_MS = 60_000;

function _cacheKey(symbol, dateStr) {
  return `${symbol}:${dateStr}`;
}

function _cacheGet(symbol, dateStr) {
  const entry = _cache.get(_cacheKey(symbol, dateStr));
  if (!entry) return null;
  if (_nowMs() - entry.ts > CACHE_TTL_MS) {
    _cache.delete(_cacheKey(symbol, dateStr));
    return null;
  }
  return entry.value;
}

function _cacheSet(symbol, dateStr, value) {
  _cache.set(_cacheKey(symbol, dateStr), { ts: _nowMs(), value });
}

// ---------------------------------------------------------------------------
// Fallback table (refreshed daily by a separate cron — stored here as last-
// known-good values so the oracle degrades gracefully instead of failing hard)
// ---------------------------------------------------------------------------

const _fallbackTable = {
  'TON':     2.50,
  'TON-BSC': 2.50,
  'BTC':     65000,
  'BTC-TON': 65000,
  'ETH':     3500,
  'BNB':     600,
  'SOL':     170,
  'TRX':     0.12,
  'LTC':     90,
  'XRP':     0.60,
  'DOGE':    0.15,
  'MATIC':   0.70,
};

/** Allows tests and the daily cron to update the table at runtime. */
export function updateFallbackTable(entries) {
  Object.assign(_fallbackTable, entries);
}

// ---------------------------------------------------------------------------
// Source 1 — ChangeNOW partner endpoint
// ---------------------------------------------------------------------------

/**
 * ChangeNOW v2 exchange info endpoint.
 * When a swap carries a USD amount the response includes `amountInUsd`.
 *
 * Docs: https://doc.changenow.io/api/v2/api/exchange/get-exchange-information
 *
 * @param {string} partnerId  - the ChangeNOW partner transaction id (id field)
 * @returns {number|null}     - amountInUsd or null
 */
export async function fetchChangeNowUsd(partnerId, { fetch: _fetch = fetch } = {}) {
  if (!partnerId) return null;
  const apiKey = typeof process !== 'undefined'
    ? process.env.CHANGENOW_API_KEY
    : undefined;
  if (!apiKey) return null;

  const url = `https://api.changenow.io/v2/exchange/by-id?id=${encodeURIComponent(partnerId)}&apiKey=${apiKey}`;
  const res = await _fetch(url, { headers: { 'x-changenow-api-key': apiKey } });
  if (!res.ok) return null;

  const data = await res.json();
  const usd = Number(data?.amountInUsd ?? data?.toAmountInUsd ?? data?.fromAmountInUsd);
  return Number.isFinite(usd) && usd > 0 ? usd : null;
}

// ---------------------------------------------------------------------------
// Source 2 — CoinGecko history
// ---------------------------------------------------------------------------

/**
 * Convert a Unix timestamp (seconds) to the CoinGecko date string DD-MM-YYYY.
 */
export function unixSecToCoingeckoDate(atUnixSec) {
  const d = new Date(atUnixSec * 1000);
  const dd   = String(d.getUTCDate()).padStart(2, '0');
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * CoinGecko /coins/{id}/history endpoint.
 * Free tier: 50 req/min.  Callers (bulk accrual job) must rate-limit themselves.
 *
 * @returns {number|null}
 */
export async function fetchCoinGeckoUsd(coinId, dateStr, { fetch: _fetch = fetch } = {}) {
  if (!coinId || !dateStr) return null;

  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/history?date=${dateStr}&localization=false`;
  const res = await _fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;

  const data = await res.json();
  const usd = data?.market_data?.current_price?.usd;
  return Number.isFinite(usd) && usd > 0 ? Number(usd) : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} UsdValueParams
 * @property {string} symbol        - ChangeNOW asset ticker, e.g. "TON-BSC"
 * @property {number} amount        - quantity of the asset (from-amount)
 * @property {number} atUnixSec     - swap finish time as Unix timestamp (seconds)
 * @property {string} [partnerId]   - ChangeNOW exchange id (enables source 1)
 */

/**
 * @typedef {Object} UsdValueResult
 * @property {number} usd
 * @property {'changenow'|'coingecko'|'fallback'} source
 */

/**
 * Resolve the USD value of a completed swap.
 *
 * @param {UsdValueParams} params
 * @param {object} [deps]  - injectable dependencies for testing
 * @returns {Promise<UsdValueResult|null>}  null when all sources fail (retry later)
 */
export async function usdValue(params, deps = {}) {
  const { symbol, amount, atUnixSec, partnerId } = params;
  const _fetch = deps.fetch ?? fetch;

  // Stablecoins: always 1.000
  if (STABLECOINS.has(symbol)) {
    return { usd: Number(amount) * 1.0, source: 'changenow' };
  }

  const dateStr = unixSecToCoingeckoDate(atUnixSec);

  // --- Runtime cache check (keyed by symbol + date) ---
  const cached = _cacheGet(symbol, dateStr);
  if (cached != null) {
    return { usd: Number(amount) * cached, source: cached.__source };
  }

  // --- Source 1: ChangeNOW ---
  try {
    const totalUsd = await fetchChangeNowUsd(partnerId, { fetch: _fetch });
    if (totalUsd != null) {
      const rate = Number(amount) > 0 ? totalUsd / Number(amount) : 0;
      _cacheSet(symbol, dateStr, Object.assign(rate, { __source: 'changenow' }));
      return { usd: totalUsd, source: 'changenow' };
    }
  } catch (_) { /* fall through */ }

  // --- Source 2: CoinGecko ---
  const coinId = SYMBOL_TO_COINGECKO_ID[symbol];
  if (coinId) {
    try {
      const rate = await fetchCoinGeckoUsd(coinId, dateStr, { fetch: _fetch });
      if (rate != null) {
        const rateWithSource = Object.assign(rate, { __source: 'coingecko' });
        _cacheSet(symbol, dateStr, rateWithSource);
        return { usd: Number(amount) * rate, source: 'coingecko' };
      }
    } catch (_) { /* fall through */ }
  }

  // --- Source 3: fallback table ---
  const fallbackRate = _fallbackTable[symbol];
  if (fallbackRate != null) {
    return { usd: Number(amount) * fallbackRate, source: 'fallback' };
  }

  // All sources failed
  return null;
}

// ---------------------------------------------------------------------------
// Test-only helpers (not exported in production builds)
// ---------------------------------------------------------------------------

export function _testSetNow(fn) { _nowMs = fn; }
export function _testClearCache() { _cache.clear(); }
