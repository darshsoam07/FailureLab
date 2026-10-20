/**
 * Traffic generator utilities and limits.
 *
 * Backend constraint from traffic_gen.py:
 * requests_per_second: int = Field(default=1, ge=1, le=10, strict=True)
 */

export const MIN_RPS = 1;
export const MAX_RPS = 10;
export const DEFAULT_RPS = 1;

/**
 * Clamps requests per second to a valid integer between 1 and 10.
 *
 * @param {any} value
 * @returns {number} Integer between 1 and 10
 */
export function clampRps(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return DEFAULT_RPS;
  }
  const rounded = Math.round(num);
  if (rounded < MIN_RPS) return MIN_RPS;
  if (rounded > MAX_RPS) return MAX_RPS;
  return rounded;
}

/**
 * Calculates success fidelity percentage from sent and accepted orders.
 *
 * @param {number} totalSent
 * @param {number} accepted
 * @returns {number} Percentage between 0 and 100 (rounded to 1 decimal place)
 */
export function calculateSuccessFidelity(totalSent, accepted) {
  const sent = Number(totalSent);
  const ok = Number(accepted);
  if (!Number.isFinite(sent) || sent <= 0 || !Number.isFinite(ok) || ok < 0) {
    return 100; // Default when no traffic has been dispatched
  }
  const ratio = (ok / sent) * 100;
  return Number(Math.max(0, Math.min(100, ratio)).toFixed(1));
}
