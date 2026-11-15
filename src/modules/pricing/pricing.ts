import { Money, type Paise } from '@/lib/money';

export type PricedPaymentMethod = 'COD' | 'ONLINE';

export interface PricingLine {
  lineKey: string;
  unitPricePaise: number;
  quantity: number;
  taxRateBasisPoints: number;
}

export interface PricingFees {
  shippingFeePaise: number;
  freeShippingThresholdPaise: number;
  codFeePaise: number;
}

export interface PricedLine {
  lineKey: string;
  lineTotalPaise: Paise;
  discountPaise: Paise;
  taxPaise: Paise;
}

export interface PriceBreakdown {
  lines: PricedLine[];
  subtotalPaise: Paise;
  discountPaise: Paise;
  taxPaise: Paise;
  shippingFeePaise: Paise;
  codFeePaise: Paise;
  totalPaise: Paise;
}

const basisPointsPerWhole = 10_000;

function roundHalfUpNonNegative(numerator: number, denominator: number): number {
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

// Prices are GST-inclusive (plan §10A rule 9): the tax is the included component, price × r / (1 + r).
export function includedTaxPaise(amountPaise: number, taxRateBasisPoints: number): Paise {
  return Money.fromPaise(
    roundHalfUpNonNegative(
      amountPaise * taxRateBasisPoints,
      basisPointsPerWhole + taxRateBasisPoints,
    ),
  );
}

// Splits an order discount over lines in proportion to their totals (largest remainder, ties to the
// earlier line), so the per-line tax is computed on what the customer actually pays for that line.
export function allocateDiscount(
  lineTotalsPaise: readonly number[],
  discountPaise: number,
): Paise[] {
  const subtotal = lineTotalsPaise.reduce((total, amount) => total + amount, 0);
  if (subtotal === 0 || discountPaise === 0) return lineTotalsPaise.map(() => Money.zero);
  const shares = lineTotalsPaise.map((amount, index) => {
    const exact = amount * discountPaise;
    return { index, floor: Math.floor(exact / subtotal), remainder: exact % subtotal };
  });
  let unallocated = discountPaise - shares.reduce((total, share) => total + share.floor, 0);
  const byRemainder = [...shares].sort(
    (left, right) => right.remainder - left.remainder || left.index - right.index,
  );
  const allocated = shares.map((share) => share.floor);
  for (const share of byRemainder) {
    if (unallocated === 0) break;
    allocated[share.index] = (allocated[share.index] ?? 0) + 1;
    unallocated -= 1;
  }
  return allocated.map((amount) => Money.fromPaise(amount));
}

// Shipping is free when the amount after the coupon reaches the threshold; the COD fee applies to Cash on
// Delivery only. Tax is included in line prices and is not added to the total.
export function priceOrder(input: {
  lines: readonly PricingLine[];
  discountPaise: number;
  fees: PricingFees;
  paymentMethod: PricedPaymentMethod;
}): PriceBreakdown {
  const lineTotals = input.lines.map((line) =>
    Money.multiplyByQuantity(Money.fromPaise(line.unitPricePaise), line.quantity),
  );
  const subtotalPaise = Money.add(...lineTotals);
  const discountPaise = Money.min(Money.fromPaise(input.discountPaise), subtotalPaise);
  const lineDiscounts = allocateDiscount(lineTotals, discountPaise);
  const lines = input.lines.map((line, index) => {
    const lineTotalPaise = lineTotals[index] ?? Money.zero;
    const lineDiscountPaise = lineDiscounts[index] ?? Money.zero;
    return {
      lineKey: line.lineKey,
      lineTotalPaise,
      discountPaise: lineDiscountPaise,
      taxPaise: includedTaxPaise(lineTotalPaise - lineDiscountPaise, line.taxRateBasisPoints),
    };
  });
  const afterDiscountPaise = Money.subtract(subtotalPaise, discountPaise);
  const isShippingFree =
    input.lines.length === 0 || afterDiscountPaise >= input.fees.freeShippingThresholdPaise;
  const shippingFeePaise = isShippingFree
    ? Money.zero
    : Money.fromPaise(input.fees.shippingFeePaise);
  const codFeePaise =
    input.paymentMethod === 'COD' && input.lines.length > 0
      ? Money.fromPaise(input.fees.codFeePaise)
      : Money.zero;
  return {
    lines,
    subtotalPaise,
    discountPaise,
    taxPaise: Money.add(...lines.map((line) => line.taxPaise)),
    shippingFeePaise,
    codFeePaise,
    totalPaise: Money.add(afterDiscountPaise, shippingFeePaise, codFeePaise),
  };
}
