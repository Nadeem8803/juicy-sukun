import type { PublicConfig } from './types';

/**
 * Loyalty rule set by the owner: after `loyaltyAfter` completed orders, every next order gets `loyaltyPercent` % off.
 * Returns the discount percent for a customer who has `completed` finished orders (0 = no discount).
 */
export function loyaltyPercentFor(
  cfg: Pick<PublicConfig, 'loyaltyEnabled' | 'loyaltyAfter' | 'loyaltyPercent'>,
  completed: number,
): number {
  if (!cfg.loyaltyEnabled) return 0;
  const after = Math.max(1, Math.floor(cfg.loyaltyAfter || 0));
  const pct = Math.max(0, Math.min(50, Math.round(cfg.loyaltyPercent || 0)));
  return completed >= after ? pct : 0;
}
