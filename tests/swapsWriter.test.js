/**
 * Unit tests for swapsWriter.js (issue #47)
 *
 * Run:  node --test tests/swapsWriter.test.js
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { onSwapFinished } from '../src/swapsWriter.js';
import { _testClearCache, updateFallbackTable } from '../src/usdOracle.js';

const AT_UNIX = 1_700_000_000;

beforeEach(() => {
  _testClearCache();
  delete process.env.CHANGENOW_API_KEY;
});

function makeDb() {
  const calls = [];
  return {
    calls,
    updateSwap: async (id, fields) => { calls.push({ id, fields }); },
  };
}

function makeRetryQueue() {
  const items = [];
  return { items, push: async (id) => { items.push(id); } };
}

describe('onSwapFinished', () => {
  test('writes turnover_usd and usd_rate_source from CoinGecko', async () => {
    const db = makeDb();
    const _fetch = async () => ({
      ok: true,
      json: async () => ({ market_data: { current_price: { usd: 2.5 } } }),
    });

    const result = await onSwapFinished(
      { swapId: 7, symbol: 'TON', amount: 10, atUnixSec: AT_UNIX },
      { db, fetch: _fetch },
    );

    assert.deepEqual(result, { usd: 25, source: 'coingecko' });
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].id, 7);
    assert.equal(db.calls[0].fields.turnover_usd, 25);
    assert.equal(db.calls[0].fields.usd_rate_source, 'coingecko');
  });

  test('writes usd_rate_source "fallback" when CoinGecko fails', async () => {
    updateFallbackTable({ TON: 3.0 });
    const db = makeDb();
    const _fetch = async () => ({ ok: false, json: async () => ({}) });

    const result = await onSwapFinished(
      { swapId: 9, symbol: 'TON', amount: 4, atUnixSec: AT_UNIX },
      { db, fetch: _fetch },
    );

    assert.deepEqual(result, { usd: 12, source: 'fallback' });
    assert.equal(db.calls[0].fields.usd_rate_source, 'fallback');
  });

  test('returns null and pushes to retryQueue when all sources fail', async () => {
    const db = makeDb();
    const retryQueue = makeRetryQueue();
    const _fetch = async () => { throw new Error('network error'); };

    const result = await onSwapFinished(
      { swapId: 42, symbol: 'UNKNOWN-XYZ', amount: 1, atUnixSec: AT_UNIX },
      { db, retryQueue, fetch: _fetch },
    );

    assert.equal(result, null);
    assert.equal(db.calls.length, 0, 'db.updateSwap must not be called on failure');
    assert.deepEqual(retryQueue.items, [42]);
  });

  test('stablecoin USDT writes changenow source without any fetch', async () => {
    const db = makeDb();
    const _fetch = async () => { throw new Error('should not call'); };

    const result = await onSwapFinished(
      { swapId: 3, symbol: 'USDT', amount: 500, atUnixSec: AT_UNIX },
      { db, fetch: _fetch },
    );

    assert.deepEqual(result, { usd: 500, source: 'changenow' });
    assert.equal(db.calls[0].fields.turnover_usd, 500);
    assert.equal(db.calls[0].fields.usd_rate_source, 'changenow');
  });
});
