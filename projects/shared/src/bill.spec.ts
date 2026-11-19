import { describe, expect, it } from 'vitest';
import { billLines, kotLines } from './bill';
import type { Order } from './types';

const base = {
  status: 'accepted', createdAt: Date.UTC(2026, 10, 7, 16, 15), subtotal: 100, deliveryFee: 0, total: 100, orderType: 'dine_in', table: '4', number: '1042',
  lines: [{ qty: 2, name: 'Cold Coffee', total: 100 }],
  invoice: { cafeName: 'Juicysukun Cafe', cafeAddress: 'Near Bharat Gas Godown, Station Road Bypass Chowk, Akkalkot, Solapur 413216', cafePhone: '9876543210', fssai: '21526041005767' },
} as unknown as Order;

describe('bill text', () => {
  it('fits 32 columns and wraps a long address', () => {
    const lines = billLines([base]);
    expect(lines.every((l) => l.length <= 32)).toBe(true);
    expect(lines.filter((l) => /Godown|Road Bypass|Solapur/.test(l)).length).toBe(3);
    expect(lines.some((l) => l.trim() === 'FSSAI: 21526041005767')).toBe(true);
  });
  it('leaves the cafe name to the logo when one is printed', () => {
    expect(billLines([base], 32, true).some((l) => /JUICYSUKUN/.test(l))).toBe(false);
    expect(billLines([base], 32, false)[0]).toContain('JUICYSUKUN CAFE');
  });
  it('shows payment state', () => {
    expect(billLines([base])).toContain('Payment pending');
    expect(billLines([{ ...base, payment: { method: 'upi', at: 1 } } as Order])).toContain('Paid: UPI');
  });
  it('marks an add-on kitchen slip', () => {
    expect(kotLines(base, 32, true)).toContain('** ADD-ON ORDER **');
    expect(kotLines(base)).not.toContain('** ADD-ON ORDER **');
  });
});
