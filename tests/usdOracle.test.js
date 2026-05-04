/**
 * Unit tests for usdOracle.js (issue #47)
 *
 * Uses Node.js built-in test runner (node:test + node:assert).
 * Run:  node --test tests/usdOracle.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  usdValue,
  unixSecToCoingeckoDate,
  updateFallbackTable,
  _testClearCache,
  _testSetNow,
} from '../src/usdOracle.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AT_UNIX = 1_700_000_000; // 2023-11-14 22:13:20 UTC

function makeFetch(responses) {
  // responses: Map<url_substring, { ok, json }>
  return async (url) => {
    for (const [key, resp] of Object.entries(responses)) {
      if (url.includes(key)) {
        return {
          ok:   resp.ok ?? true,
          json: async () => resp.json,
        };
      }
    }
    // Unmatched URL → network error
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  _testClearCache();
  _testSetNow(() => Date.now());
});

// ---------------------------------------------------------------------------
// unixSecToCoingeckoDate
// ---------------------------------------------------------------------------

describe('unixSecToCoingeckoDate', () => {
  test('converts unix timestamp to DD-MM-YYYY', () => {
    // 2023-11-14 22:13:20 UTC → "14-11-2023"
    assert.equal(unixSecToCoingeckoDate(AT_UNIX), '14-11-2023');
  });

  test('handles month/day padding', () => {
    // 2024-01-05 00:00:00 UTC
    assert.equal(unixSecToCoingeckoDate(1704412800), '05-01-2024');
  });
});

// ---------------------------------------------------------------------------
// Source 1: ChangeNOW
// ---------------------------------------------------------------------------

describe('usdValue — Source 1 (ChangeNOW)', () => {
  test('returns changenow source when amountInUsd is present', async () => {
    // ChangeNOW returns amountInUsd; no CoinGecko call needed
    const _fetch = makeFetch({
      'changenow.io': { ok: true, json: { amountInUsd: 250 } },
    });

    // Ensure CHANGENOW_API_KEY is set for the branch to fire
    process.env.CHANGENOW_API_KEY = 'test-key';

    const result = await usdValue(
      { symbol: 'TON', amount: 100, atUnixSec: AT_UNIX, partnerId: 'abc123' },
      { fetch: _fetch },
    );

    assert.deepEqual(result, { usd: 250, source: 'changenow' });
  });

  test('stablecoin (USDT-TON) returns 1.000 per unit without any API call', async () => {
    const _fetch = makeFetch({}); // should never be called
    const result = await usdValue(
      { symbol: 'USDT-TON', amount: 42, atUnixSec: AT_UNIX },
      { fetch: _fetch },
    );
    assert.deepEqual(result, { usd: 42, source: 'changenow' });
  });

  test('stablecoin USDT returns exact amount', async () => {
    const result = await usdValue(
      { symbol: 'USDT', amount: 100.5, atUnixSec: AT_UNIX },
      { fetch: async () => { throw new Error('should not call'); } },
    );
    assert.deepEqual(result, { usd: 100.5, source: 'changenow' });
  });
});

// ---------------------------------------------------------------------------
// Source 2: CoinGecko
// ---------------------------------------------------------------------------

describe('usdValue — Source 2 (CoinGecko)', () => {
  test('falls back to CoinGecko when ChangeNOW returns no USD', async () => {
    process.env.CHANGENOW_API_KEY = 'test-key';

    const _fetch = makeFetch({
      'changenow.io': { ok: true, json: {} },          // no amountInUsd
      'coingecko.com': {
        ok: true,
        json: { market_data: { current_price: { usd: 2.50 } } },
      },
    });

    const result = await usdValue(
      { symbol: 'TON', amount: 10, atUnixSec: AT_UNIX, partnerId: 'abc123' },
      { fetch: _fetch },
    );

    assert.deepEqual(result, { usd: 25, source: 'coingecko' });
  });

  test('falls back to CoinGecko when ChangeNOW API key is absent', async () => {
    delete process.env.CHANGENOW_API_KEY;

    const _fetch = makeFetch({
      'coingecko.com': {
        ok: true,
        json: { market_data: { current_price: { usd: 65000 } } },
      },
    });

    const result = await usdValue(
      { symbol: 'BTC', amount: 0.5, atUnixSec: AT_UNIX },
      { fetch: _fetch },
    );

    assert.deepEqual(result, { usd: 32500, source: 'coingecko' });
  });

  test('uses TON-BSC mapped to same CoinGecko id as TON', async () => {
    delete process.env.CHANGENOW_API_KEY;

    const _fetch = makeFetch({
      'coingecko.com/api/v3/coins/the-open-network': {
        ok: true,
        json: { market_data: { current_price: { usd: 3.0 } } },
      },
    });

    const result = await usdValue(
      { symbol: 'TON-BSC', amount: 5, atUnixSec: AT_UNIX },
      { fetch: _fetch },
    );

    assert.deepEqual(result, { usd: 15, source: 'coingecko' });
  });
});

// ---------------------------------------------------------------------------
// Source 3: Fallback table
// ---------------------------------------------------------------------------

describe('usdValue — Source 3 (fallback table)', () => {
  test('uses fallback table when both APIs fail', async () => {
    delete process.env.CHANGENOW_API_KEY;

    const _fetch = makeFetch({
      'coingecko.com': { ok: false, json: {} },
    });

    updateFallbackTable({ TON: 2.50 });

    const result = await usdValue(
      { symbol: 'TON', amount: 4, atUnixSec: AT_UNIX },
      { fetch: _fetch },
    );

    assert.deepEqual(result, { usd: 10, source: 'fallback' });
  });

  test('updateFallbackTable overrides existing entry', async () => {
    delete process.env.CHANGENOW_API_KEY;

    const _fetch = makeFetch({
      'coingecko.com': { ok: false, json: {} },
    });

    updateFallbackTable({ TON: 5.0 });

    const result = await usdValue(
      { symbol: 'TON', amount: 2, atUnixSec: AT_UNIX },
      { fetch: _fetch },
    );

    assert.equal(result?.usd, 10);
    assert.equal(result?.source, 'fallback');
  });
});

// ---------------------------------------------------------------------------
// Failure path: all sources fail → null + retry
// ---------------------------------------------------------------------------

describe('usdValue — failure path (all sources fail)', () => {
  test('returns null when all sources fail for an unknown symbol', async () => {
    delete process.env.CHANGENOW_API_KEY;

    const _fetch = makeFetch({
      'coingecko.com': { ok: false, json: {} },
    });

    const result = await usdValue(
      { symbol: 'UNKNOWN-XYZ', amount: 1, atUnixSec: AT_UNIX },
      { fetch: _fetch },
    );

    assert.equal(result, null);
  });

  test('returns null when CoinGecko network throws and symbol not in fallback', async () => {
    delete process.env.CHANGENOW_API_KEY;

    const _fetch = async () => { throw new Error('network error'); };

    const result = await usdValue(
      { symbol: 'UNKNOWN-XYZ', amount: 1, atUnixSec: AT_UNIX },
      { fetch: _fetch },
    );

    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// KV cache
// ---------------------------------------------------------------------------

describe('usdValue — KV cache', () => {
  test('second call for same symbol+date is served from cache (no extra fetch)', async () => {
    delete process.env.CHANGENOW_API_KEY;

    let callCount = 0;
    const _fetch = async (url) => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ market_data: { current_price: { usd: 2.5 } } }),
      };
    };

    await usdValue({ symbol: 'TON', amount: 1, atUnixSec: AT_UNIX }, { fetch: _fetch });
    await usdValue({ symbol: 'TON', amount: 2, atUnixSec: AT_UNIX }, { fetch: _fetch });

    assert.equal(callCount, 1, 'CoinGecko should only be called once');
  });

  test('cache expires after 60 s and re-fetches', async () => {
    delete process.env.CHANGENOW_API_KEY;

    let fakeNow = 1_000_000;
    _testSetNow(() => fakeNow);

    let callCount = 0;
    const _fetch = async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({ market_data: { current_price: { usd: 3.0 } } }),
      };
    };

    await usdValue({ symbol: 'TON', amount: 1, atUnixSec: AT_UNIX }, { fetch: _fetch });

    // Advance clock past TTL
    fakeNow += 61_000;

    await usdValue({ symbol: 'TON', amount: 1, atUnixSec: AT_UNIX }, { fetch: _fetch });

    assert.equal(callCount, 2, 'Should re-fetch after cache TTL expires');
  });
});
