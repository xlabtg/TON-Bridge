import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  shouldNotify,
  getNotificationText,
  buildDeepLink,
  POLLING_STATES,
  TERMINAL_STATES,
} from '../src/index.js';

describe('notification helpers', () => {
  it('detects polling-to-terminal transitions', () => {
    assert.equal(shouldNotify('exchanging', 'finished', false), true);
    assert.equal(shouldNotify('confirming', 'failed', false), true);
    assert.equal(shouldNotify('sending', 'refunded', false), true);
  });

  it('is idempotent on re-runs', () => {
    assert.equal(shouldNotify('exchanging', 'finished', true), false);
    assert.equal(shouldNotify('finished', 'finished', false), false);
    assert.equal(shouldNotify('failed', 'refunded', false), false);
  });

  it('does not notify for non-terminal states', () => {
    for (const state of POLLING_STATES) {
      assert.equal(shouldNotify(null, state, false), false);
    }
  });

  it('returns localized terminal-state text', () => {
    assert.equal(getNotificationText('finished', 'en'), '✅ Your TON has arrived. View order →');
    assert.equal(getNotificationText('finished', 'ru'), '✅ TON получены. Открыть заказ →');
    assert.equal(getNotificationText('failed', 'en'), '⚠️ Exchange refunded — tap to see details');
    assert.equal(getNotificationText('refunded', 'de'), '⚠️ Exchange refunded — tap to see details');
    assert.equal(getNotificationText('unknown', 'en'), null);
  });

  it('builds order deep links', () => {
    assert.equal(
      buildDeepLink('abcd-1234'),
      'https://t.me/TONBridge_robot/app?startapp=order_abcd-1234',
    );
  });

  it('keeps polling and terminal state sets disjoint', () => {
    for (const state of POLLING_STATES) {
      assert.equal(TERMINAL_STATES.has(state), false);
    }
  });
});
