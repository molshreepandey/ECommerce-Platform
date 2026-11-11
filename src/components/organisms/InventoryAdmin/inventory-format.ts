// Display helpers for the admin inventory pages. Quantities and dates follow en-IN conventions; dates are
// shown in India Standard Time, the store's time zone.

const quantityFormat = new Intl.NumberFormat('en-IN');
const dateTimeFormat = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

export function formatQuantity(quantity: number): string {
  return quantityFormat.format(quantity);
}

// A movement's change, always signed: +5, −3 (a real minus sign).
export function formatQuantityChange(quantityDelta: number): string {
  if (quantityDelta > 0) return `+${formatQuantity(quantityDelta)}`;
  if (quantityDelta < 0) return `−${formatQuantity(-quantityDelta)}`;
  return '0';
}

export function formatDateTime(value: Date | string): string {
  return dateTimeFormat.format(typeof value === 'string' ? new Date(value) : value);
}

export const movementTypeLabels: Readonly<Record<string, string>> = {
  RESERVE: 'Reserved',
  RELEASE: 'Released',
  DISPATCH: 'Dispatched',
  RETURN_RESTOCK: 'Return restocked',
  RTO_RESTOCK: 'RTO restocked',
  ADJUSTMENT: 'Adjustment',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
  RECEIPT: 'Receipt',
};

export function movementTypeLabel(movementType: string): string {
  return movementTypeLabels[movementType] ?? movementType;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

// A calendar date chosen in the filter form, as the ISO instant the ledger API expects (India Standard
// Time). "from" is the start of that day; "to" is the start of the next day, because the API's upper bound
// is exclusive, so the whole chosen day is included. Returns null for anything that is not a real date.
export function ledgerDateBound(date: string, edge: 'from' | 'to'): string | null {
  if (!datePattern.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  const start = new Date(Date.UTC(year, month - 1, day));
  if (
    start.getUTCFullYear() !== year ||
    start.getUTCMonth() !== month - 1 ||
    start.getUTCDate() !== day
  ) {
    return null;
  }
  if (edge === 'to') start.setUTCDate(start.getUTCDate() + 1);
  return `${start.toISOString().slice(0, 10)}T00:00:00+05:30`;
}

export type StockState = 'out' | 'low' | 'ok';

// Out of stock when nothing is available; low when the inventory rules flag it (threshold reached).
export function stockState(level: { availableQuantity: number; isLowStock: boolean }): StockState {
  if (level.availableQuantity <= 0) return 'out';
  if (level.isLowStock) return 'low';
  return 'ok';
}
