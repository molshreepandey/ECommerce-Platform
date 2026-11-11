import { describe, expect, it } from 'vitest';

import {
  formatDateTime,
  formatQuantity,
  formatQuantityChange,
  ledgerDateBound,
  movementTypeLabel,
  stockState,
} from './inventory-format';

describe('inventory display helpers', () => {
  it('formats quantities and changes with Indian digit grouping and a signed change', () => {
    expect(formatQuantity(1_234_567)).toBe('12,34,567');
    expect(formatQuantityChange(1500)).toBe('+1,500');
    expect(formatQuantityChange(-3)).toBe('−3');
    expect(formatQuantityChange(0)).toBe('0');
  });

  it('shows times in India Standard Time', () => {
    expect(formatDateTime('2026-11-12T18:45:00Z')).toMatch(/13 Nov 2026.*12:15/);
  });

  it('turns a chosen day into the API bounds that include the whole day in IST', () => {
    expect(ledgerDateBound('2026-11-12', 'from')).toBe('2026-11-12T00:00:00+05:30');
    expect(ledgerDateBound('2026-11-12', 'to')).toBe('2026-11-13T00:00:00+05:30');
    expect(ledgerDateBound('2026-12-31', 'to')).toBe('2027-01-01T00:00:00+05:30');
    for (const invalid of ['', '2026-02-30', '12-11-2026', '2026-13-01', 'yesterday']) {
      expect(ledgerDateBound(invalid, 'from'), invalid).toBeNull();
    }
  });

  it('labels movement types and keeps unknown ones as they are', () => {
    expect(movementTypeLabel('RECEIPT')).toBe('Receipt');
    expect(movementTypeLabel('ADJUSTMENT')).toBe('Adjustment');
    expect(movementTypeLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('calls a level out of stock, low or fine', () => {
    expect(stockState({ availableQuantity: 0, isLowStock: true })).toBe('out');
    expect(stockState({ availableQuantity: 3, isLowStock: true })).toBe('low');
    expect(stockState({ availableQuantity: 30, isLowStock: false })).toBe('ok');
  });
});
