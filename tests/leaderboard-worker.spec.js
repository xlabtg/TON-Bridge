/**
 * Unit tests for the leaderboard Cloudflare Worker.
 * Tests run with Playwright's test runner (Node, no browser needed).
 */
import { test, expect } from '@playwright/test';
import {
  hashUserId,
  formatUsd,
  buildDeepLink,
  buildMessage,
  aggregateLeaderboard,
} from '../worker/leaderboard.js';

// ---------------------------------------------------------------------------
// hashUserId
// ---------------------------------------------------------------------------
test.describe('hashUserId', () => {
  test('returns an 8-character uppercase hex string', async () => {
    const hash = await hashUserId(123456789);
    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[0-9A-F]{8}$/);
  });

  test('is deterministic for the same input', async () => {
    const h1 = await hashUserId('42');
    const h2 = await hashUserId('42');
    expect(h1).toBe(h2);
  });

  test('produces different hashes for different ids', async () => {
    const h1 = await hashUserId(1);
    const h2 = await hashUserId(2);
    expect(h1).not.toBe(h2);
  });

  test('accepts numeric and string inputs', async () => {
    const hNum = await hashUserId(99);
    const hStr = await hashUserId('99');
    expect(hNum).toBe(hStr);
  });
});

// ---------------------------------------------------------------------------
// formatUsd
// ---------------------------------------------------------------------------
test.describe('formatUsd', () => {
  test('formats millions compactly', () => {
    expect(formatUsd(1_234_567)).toBe('$1.23M');
  });

  test('formats thousands with comma separator', () => {
    expect(formatUsd(9876)).toBe('$9,876');
  });

  test('formats small amounts with two decimals', () => {
    expect(formatUsd(0.5)).toBe('$0.50');
  });

  test('formats exactly 1 000 000 as millions', () => {
    expect(formatUsd(1_000_000)).toBe('$1.00M');
  });
});

// ---------------------------------------------------------------------------
// buildDeepLink
// ---------------------------------------------------------------------------
test.describe('buildDeepLink', () => {
  test('returns a t.me deep-link URL with lowercase pair as startapp param', () => {
    const link = buildDeepLink('TON', 'BSC');
    expect(link).toBe('https://t.me/TONBridge_robot/app?startapp=ton_bsc');
  });

  test('normalises pairs to lowercase', () => {
    const link = buildDeepLink('BTC', 'ETH');
    expect(link).toContain('startapp=btc_eth');
  });
});

// ---------------------------------------------------------------------------
// buildMessage
// ---------------------------------------------------------------------------
test.describe('buildMessage', () => {
  const topBridges = [
    { rank: 1, display: 'User AB12CD34', usd: 5000, from: 'ton', to: 'bsc' },
    { rank: 2, display: '@alice',        usd: 3000, from: 'ton', to: 'eth' },
    { rank: 3, display: 'User EF56GH78', usd: 1500, from: 'btc', to: 'ton' },
  ];

  test('includes the date heading', () => {
    const msg = buildMessage(topBridges, 9500, 3, 'ton', 'bsc');
    expect(msg).toContain('🏆 TON Bridge — Top Bridges');
  });

  test('includes all top bridge entries', () => {
    const msg = buildMessage(topBridges, 9500, 3, 'ton', 'bsc');
    expect(msg).toContain('User AB12CD34');
    expect(msg).toContain('@alice');
    expect(msg).toContain('User EF56GH78');
  });

  test('includes total volume', () => {
    const msg = buildMessage(topBridges, 9500, 3, 'ton', 'bsc');
    expect(msg).toContain('Total volume');
    expect(msg).toContain('$9,500');
  });

  test('includes total swaps count', () => {
    const msg = buildMessage(topBridges, 9500, 3, 'ton', 'bsc');
    expect(msg).toContain('Total swaps');
    expect(msg).toContain('3');
  });

  test('uses HTML bold tags', () => {
    const msg = buildMessage(topBridges, 9500, 3, 'ton', 'bsc');
    expect(msg).toContain('<b>');
    expect(msg).toContain('</b>');
  });
});

// ---------------------------------------------------------------------------
// aggregateLeaderboard
// ---------------------------------------------------------------------------
test.describe('aggregateLeaderboard', () => {
  function makeTx(userId, amountTo, toUsdRate, from, to, status = 'finished') {
    return { userId, amountTo, toUsdRate, fromCurrency: from, toCurrency: to, status };
  }

  test('returns null when there are no finished transactions', async () => {
    const txs = [makeTx('1', 10, 1, 'ton', 'bsc', 'waiting')];
    const result = await aggregateLeaderboard(txs, null);
    expect(result).toBeNull();
  });

  test('returns null for an empty array', async () => {
    const result = await aggregateLeaderboard([], null);
    expect(result).toBeNull();
  });

  test('counts only finished/success statuses', async () => {
    const txs = [
      makeTx('1', 100, 2, 'ton', 'bsc', 'finished'),
      makeTx('2', 50,  2, 'ton', 'eth', 'waiting'),
      makeTx('3', 75,  2, 'btc', 'ton', 'success'),
    ];
    const result = await aggregateLeaderboard(txs, null);
    expect(result.totalSwaps).toBe(2);
  });

  test('orders topBridges by descending USD volume', async () => {
    const txs = [
      makeTx('1', 10,  5,  'ton', 'bsc'), // $50
      makeTx('2', 100, 3,  'ton', 'eth'), // $300
      makeTx('3', 20,  10, 'btc', 'ton'), // $200
    ];
    const result = await aggregateLeaderboard(txs, null);
    expect(result.topBridges[0].usd).toBe(300);
    expect(result.topBridges[1].usd).toBe(200);
    expect(result.topBridges[2].usd).toBe(50);
  });

  test('limits topBridges to 3 entries even with more transactions', async () => {
    const txs = Array.from({ length: 10 }, (_, i) =>
      makeTx(String(i), i + 1, 10, 'ton', 'bsc')
    );
    const result = await aggregateLeaderboard(txs, null);
    expect(result.topBridges).toHaveLength(3);
  });

  test('computes correct total volume', async () => {
    const txs = [
      makeTx('1', 10, 2, 'ton', 'bsc'), // $20
      makeTx('2', 5,  4, 'ton', 'eth'), // $20
    ];
    const result = await aggregateLeaderboard(txs, null);
    expect(result.totalVolume).toBe(40);
  });

  test('identifies the most popular pair', async () => {
    const txs = [
      makeTx('1', 1, 1, 'ton', 'bsc'),
      makeTx('2', 1, 1, 'ton', 'bsc'),
      makeTx('3', 1, 1, 'ton', 'eth'),
    ];
    const result = await aggregateLeaderboard(txs, null);
    expect(result.popularFrom).toBe('ton');
    expect(result.popularTo).toBe('bsc');
  });

  test('anonymises users without opt-in as "User XXXXXXXX"', async () => {
    const txs = [makeTx('42', 1, 1, 'ton', 'bsc')];
    const result = await aggregateLeaderboard(txs, null);
    expect(result.topBridges[0].display).toMatch(/^User [0-9A-F]{8}$/);
  });

  test('shows @username for opted-in users', async () => {
    const txs = [{ userId: '77', username: 'alice', amountTo: 1, toUsdRate: 1, fromCurrency: 'ton', toCurrency: 'bsc', status: 'finished' }];
    const mockKv = {
      get: async key => key === 'optin:77' ? '1' : null,
    };
    const result = await aggregateLeaderboard(txs, mockKv);
    expect(result.topBridges[0].display).toBe('@alice');
  });

  test('keeps anonymised display for opted-in users missing a username', async () => {
    const txs = [{ userId: '88', amountTo: 1, toUsdRate: 1, fromCurrency: 'ton', toCurrency: 'bsc', status: 'finished' }];
    const mockKv = {
      get: async key => key === 'optin:88' ? '1' : null,
    };
    const result = await aggregateLeaderboard(txs, mockKv);
    expect(result.topBridges[0].display).toMatch(/^User [0-9A-F]{8}$/);
  });

  test('each topBridge entry has rank, display, usd, from, to', async () => {
    const txs = [makeTx('1', 50, 2, 'ton', 'bsc')];
    const result = await aggregateLeaderboard(txs, null);
    const entry = result.topBridges[0];
    expect(entry).toHaveProperty('rank', 1);
    expect(entry).toHaveProperty('display');
    expect(entry).toHaveProperty('usd');
    expect(entry).toHaveProperty('from');
    expect(entry).toHaveProperty('to');
  });
});
