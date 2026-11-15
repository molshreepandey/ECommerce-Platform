// Whole-percent discount off MRP, rounded down so the label never promises more than the real saving.
export function discountPercent(pricePaise: number, mrpPaise: number): number {
  if (mrpPaise <= 0 || pricePaise >= mrpPaise) return 0;
  return Math.floor(((mrpPaise - pricePaise) * 100) / mrpPaise);
}
