import { DomainError } from './errors';
import type { OrderStatus } from './types';

/** Every legal status change. Anything else is rejected. */
export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['accepted', 'rejected', 'cancelled', 'expired'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['out_for_delivery', 'delivered', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  rejected: [],
  cancelled: [],
  expired: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError('invalid_transition', `Cannot change an order from ${from} to ${to}`);
  }
}

export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Statuses where the order is still being worked on (shown in "in progress"). */
export function isActive(status: OrderStatus): boolean {
  return status === 'accepted' || status === 'preparing' || status === 'out_for_delivery';
}

/** Rejecting or cancelling after the fact must come with a reason the customer can read. */
export function needsReason(to: OrderStatus): boolean {
  return to === 'rejected' || to === 'cancelled';
}

/** The single forward button the owner sees on an active order. */
export function nextAdminStep(status: OrderStatus, type: 'delivery' | 'dine_in' = 'delivery'): OrderStatus | null {
  switch (status) {
    case 'accepted':
      return 'preparing';
    case 'preparing':
      return type === 'dine_in' ? 'delivered' : 'out_for_delivery';
    case 'out_for_delivery':
      return 'delivered';
    default:
      return null;
  }
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Waiting for cafe',
  accepted: 'Accepted',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  expired: 'Not accepted in time',
};

/** Dine-in orders are "served", not "delivered". */
export function statusLabel(status: OrderStatus, type: 'delivery' | 'dine_in' = 'delivery'): string {
  if (type === 'dine_in' && status === 'delivered') return 'Served';
  return STATUS_LABEL[status];
}

export function nextStepLabel(status: OrderStatus, type: 'delivery' | 'dine_in' = 'delivery'): string {
  const to = nextAdminStep(status, type);
  if (!to) return 'Next';
  if (type === 'dine_in' && to === 'delivered') return 'Mark served';
  return NEXT_STEP_LABEL[to] ?? 'Next';
}

export function trackerStepsFor(type: 'delivery' | 'dine_in' = 'delivery'): readonly OrderStatus[] {
  return type === 'dine_in' ? ['accepted', 'preparing', 'delivered'] : TRACKER_STEPS;
}

export const NEXT_STEP_LABEL: Record<string, string> = {
  preparing: 'Start preparing',
  out_for_delivery: 'Out for delivery',
  delivered: 'Mark delivered',
};

/** Steps shown on the customer's tracker. */
export const TRACKER_STEPS: readonly OrderStatus[] = [
  'accepted',
  'preparing',
  'out_for_delivery',
  'delivered',
];

export function trackerIndex(status: OrderStatus): number {
  return TRACKER_STEPS.indexOf(status);
}

export function trackerIndexFor(status: OrderStatus, type: 'delivery' | 'dine_in' = 'delivery'): number {
  return trackerStepsFor(type).indexOf(status);
}
