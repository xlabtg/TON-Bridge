/**
 * Point award formula (IMPROVEMENTS.md §6.0):
 *
 *   points = floor( turnover_usd × bps / 10_000 / 0.00003 )
 *          = floor( turnover_usd × bps × 3.333… )
 *
 * @param {number} turnoverUsd
 * @param {number} bps         - basis points (e.g. 10 for 0.10 %)
 * @returns {number}           - integer point count
 */
export function calcPoints(turnoverUsd, bps) {
  return Math.floor(turnoverUsd * bps / 10_000 / 0.00003);
}
