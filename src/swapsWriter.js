/**
 * Swaps writer (issue #47)
 *
 * On ChangeNOW swap completion, resolves USD turnover via usdOracle and
 * persists `turnover_usd` + `usd_rate_source` on the swaps row.
 *
 * If the oracle returns null (all sources failed) the swap id is pushed to a
 * retry queue so the accrual job (#6.5) can re-run it later.
 *
 * The DB interface is injected so this module works with any D1 / Postgres /
 * SQLite adapter without modification.
 *
 * @example
 *   import { onSwapFinished } from './swapsWriter.js';
 *   await onSwapFinished({ swapId, symbol, amount, atUnixSec, partnerId }, { db, retryQueue });
 */

import { usdValue } from './usdOracle.js';

/**
 * @typedef {Object} SwapCompletionEvent
 * @property {string|number} swapId     - internal swaps.id
 * @property {string}        symbol     - ChangeNOW from-asset ticker
 * @property {number}        amount     - from-amount
 * @property {number}        atUnixSec  - swap finish Unix timestamp (seconds)
 * @property {string}        [partnerId] - ChangeNOW exchange id (for source 1)
 */

/**
 * @typedef {Object} SwapsWriterDeps
 * @property {object}   db           - DB adapter with updateSwap(swapId, fields) method
 * @property {object}   [retryQueue] - queue adapter with push(swapId) method
 * @property {object}   [fetch]      - injectable fetch for testing
 */

/**
 * Called at swap-completion time.  Resolves USD turnover and writes it to the
 * swap row.  Returns the usdValue result or null on total failure.
 *
 * @param {SwapCompletionEvent} event
 * @param {SwapsWriterDeps}     deps
 * @returns {Promise<import('./usdOracle.js').UsdValueResult|null>}
 */
export async function onSwapFinished(event, deps) {
  const { swapId, symbol, amount, atUnixSec, partnerId } = event;
  const { db, retryQueue, fetch: _fetch } = deps;

  const result = await usdValue(
    { symbol, amount, atUnixSec, partnerId },
    _fetch ? { fetch: _fetch } : {},
  );

  if (result == null) {
    // All oracle sources failed — queue for retry
    if (retryQueue) {
      await retryQueue.push(swapId);
    }
    return null;
  }

  await db.updateSwap(swapId, {
    turnover_usd:    result.usd,
    usd_rate_source: result.source,
  });

  return result;
}
