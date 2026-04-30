/**
 * Unit tests for push-notification logic in worker/index.js
 * Covers: status-transition detection, idempotency, message text, deep-link.
 */

import { test, expect } from '@playwright/test';
import {
  shouldNotify,
  getNotificationText,
  buildDeepLink,
  POLLING_STATES,
  TERMINAL_STATES,
} from '../worker/index.js';

// ─── shouldNotify ─────────────────────────────────────────────────────────────

test.describe('shouldNotify — status-transition detection', () => {
  test('notifies when transitioning from polling state to finished', () => {
    expect(shouldNotify('exchanging', 'finished', false)).toBe(true);
  });

  test('notifies when transitioning from confirming to failed', () => {
    expect(shouldNotify('confirming', 'failed', false)).toBe(true);
  });

  test('notifies when transitioning from sending to refunded', () => {
    expect(shouldNotify('sending', 'refunded', false)).toBe(true);
  });

  test('notifies when previousState is null (first poll hits terminal)', () => {
    expect(shouldNotify(null, 'finished', false)).toBe(true);
  });

  test('is idempotent — does not re-notify when alreadyNotified is true', () => {
    expect(shouldNotify('exchanging', 'finished', true)).toBe(false);
  });

  test('does not notify for non-terminal states', () => {
    for (const state of POLLING_STATES) {
      expect(shouldNotify(null, state, false)).toBe(false);
    }
  });

  test('does not notify when both old and new state are terminal', () => {
    expect(shouldNotify('finished', 'finished', false)).toBe(false);
    expect(shouldNotify('failed', 'refunded', false)).toBe(false);
  });
});

// ─── getNotificationText ──────────────────────────────────────────────────────

test.describe('getNotificationText — i18n bodies', () => {
  test('finished EN returns correct text', () => {
    expect(getNotificationText('finished', 'en')).toBe(
      '✅ Your TON has arrived. View order →'
    );
  });

  test('finished RU returns correct text', () => {
    expect(getNotificationText('finished', 'ru')).toBe(
      '✅ TON получены. Открыть заказ →'
    );
  });

  test('failed EN returns refund text', () => {
    expect(getNotificationText('failed', 'en')).toBe(
      '⚠️ Exchange refunded — tap to see details'
    );
  });

  test('failed RU returns Russian refund text', () => {
    expect(getNotificationText('failed', 'ru')).toBe(
      '⚠️ Обмен отменён — нажмите, чтобы увидеть детали'
    );
  });

  test('refunded EN returns same text as failed EN', () => {
    expect(getNotificationText('refunded', 'en')).toBe(
      getNotificationText('failed', 'en')
    );
  });

  test('refunded RU returns same text as failed RU', () => {
    expect(getNotificationText('refunded', 'ru')).toBe(
      getNotificationText('failed', 'ru')
    );
  });

  test('unknown state returns null', () => {
    expect(getNotificationText('unknown_state', 'en')).toBeNull();
  });

  test('defaults to EN when lang is not "ru"', () => {
    expect(getNotificationText('finished', 'de')).toBe(
      getNotificationText('finished', 'en')
    );
    expect(getNotificationText('finished', undefined)).toBe(
      getNotificationText('finished', 'en')
    );
  });
});

// ─── buildDeepLink ────────────────────────────────────────────────────────────

test.describe('buildDeepLink', () => {
  test('generates the correct deep-link URL', () => {
    expect(buildDeepLink('abc123')).toBe(
      'https://t.me/TONBridge_robot/app?startapp=order_abc123'
    );
  });

  test('preserves the full order ID including hyphens', () => {
    const id = 'abcd-1234-efgh';
    expect(buildDeepLink(id)).toContain(`order_${id}`);
  });
});

// ─── State-set membership ─────────────────────────────────────────────────────

test.describe('POLLING_STATES and TERMINAL_STATES', () => {
  test('polling states are confirming, exchanging, sending', () => {
    expect(POLLING_STATES.has('confirming')).toBe(true);
    expect(POLLING_STATES.has('exchanging')).toBe(true);
    expect(POLLING_STATES.has('sending')).toBe(true);
  });

  test('terminal states are finished, failed, refunded', () => {
    expect(TERMINAL_STATES.has('finished')).toBe(true);
    expect(TERMINAL_STATES.has('failed')).toBe(true);
    expect(TERMINAL_STATES.has('refunded')).toBe(true);
  });

  test('polling and terminal sets are disjoint', () => {
    for (const s of POLLING_STATES) {
      expect(TERMINAL_STATES.has(s)).toBe(false);
    }
  });
});
