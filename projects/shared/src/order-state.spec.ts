import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import {
  TRANSITIONS,
  assertTransition,
  canTransition,
  isActive,
  isTerminal,
  needsReason,
  nextAdminStep,
  trackerIndex,
} from './order-state';
import type { OrderStatus } from './types';

const ALL = Object.keys(TRANSITIONS) as OrderStatus[];

describe('order state machine', () => {
  it('allows the happy path step by step', () => {
    const path: OrderStatus[] = ['pending', 'accepted', 'preparing', 'out_for_delivery', 'delivered'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  it('lets the owner reject or let a pending order expire, but not skip ahead', () => {
    expect(canTransition('pending', 'rejected')).toBe(true);
    expect(canTransition('pending', 'expired')).toBe(true);
    expect(canTransition('pending', 'preparing')).toBe(false);
    expect(canTransition('pending', 'delivered')).toBe(false);
  });

  it('never leaves a finished order', () => {
    for (const s of ['delivered', 'rejected', 'cancelled', 'expired'] as OrderStatus[]) {
      expect(isTerminal(s)).toBe(true);
      for (const to of ALL) expect(canTransition(s, to)).toBe(false);
    }
  });

  it('does not allow going backwards', () => {
    expect(canTransition('preparing', 'accepted')).toBe(false);
    expect(canTransition('delivered', 'out_for_delivery')).toBe(false);
  });

  it('throws a DomainError for an illegal change', () => {
    try {
      assertTransition('delivered', 'pending');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe('invalid_transition');
    }
  });

  it('offers exactly one forward step to the owner', () => {
    expect(nextAdminStep('accepted')).toBe('preparing');
    expect(nextAdminStep('preparing')).toBe('out_for_delivery');
    expect(nextAdminStep('out_for_delivery')).toBe('delivered');
    expect(nextAdminStep('pending')).toBeNull();
    expect(nextAdminStep('delivered')).toBeNull();
  });

  it('asks for a reason only on reject and cancel', () => {
    expect(needsReason('rejected')).toBe(true);
    expect(needsReason('cancelled')).toBe(true);
    expect(needsReason('accepted')).toBe(false);
    expect(needsReason('expired')).toBe(false);
  });

  it('knows which orders are in progress', () => {
    expect(isActive('accepted')).toBe(true);
    expect(isActive('preparing')).toBe(true);
    expect(isActive('out_for_delivery')).toBe(true);
    expect(isActive('pending')).toBe(false);
    expect(isActive('delivered')).toBe(false);
  });

  it('maps statuses to tracker steps', () => {
    expect(trackerIndex('pending')).toBe(-1);
    expect(trackerIndex('accepted')).toBe(0);
    expect(trackerIndex('delivered')).toBe(3);
  });
});
