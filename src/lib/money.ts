declare const paiseBrand: unique symbol;

export type Paise = number & { readonly [paiseBrand]: 'Paise' };

export class InvalidMoneyAmountError extends Error {
  constructor(value: number) {
    super(`Money amount must be a safe integer number of paise, received ${value}`);
    this.name = 'InvalidMoneyAmountError';
  }
}

const basisPointsPerWhole = 10_000;
const paisePerRupee = 100;

const rupeeFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function assertSafeInteger(value: number): void {
  if (!Number.isSafeInteger(value)) throw new InvalidMoneyAmountError(value);
}

function roundHalfUpDivision(numerator: number, denominator: number): number {
  const quotient = Math.trunc(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  if (Math.abs(remainder) * 2 >= denominator) return quotient + Math.sign(numerator);
  return quotient;
}

function fromPaise(amountPaise: number): Paise {
  assertSafeInteger(amountPaise);
  return amountPaise as Paise;
}

export const Money = {
  zero: fromPaise(0),

  fromPaise,

  add(...amountsPaise: readonly Paise[]): Paise {
    return Money.fromPaise(amountsPaise.reduce<number>((total, amount) => total + amount, 0));
  },

  subtract(minuendPaise: Paise, subtrahendPaise: Paise): Paise {
    return Money.fromPaise(minuendPaise - subtrahendPaise);
  },

  multiplyByQuantity(unitAmountPaise: Paise, quantity: number): Paise {
    assertSafeInteger(quantity);
    return Money.fromPaise(unitAmountPaise * quantity);
  },

  applyBasisPoints(amountPaise: Paise, basisPoints: number): Paise {
    assertSafeInteger(basisPoints);
    return Money.fromPaise(roundHalfUpDivision(amountPaise * basisPoints, basisPointsPerWhole));
  },

  min(firstAmountPaise: Paise, secondAmountPaise: Paise): Paise {
    return firstAmountPaise <= secondAmountPaise ? firstAmountPaise : secondAmountPaise;
  },

  max(firstAmountPaise: Paise, secondAmountPaise: Paise): Paise {
    return firstAmountPaise >= secondAmountPaise ? firstAmountPaise : secondAmountPaise;
  },

  formatRupees(amountPaise: Paise): string {
    return rupeeFormatter.format(amountPaise / paisePerRupee);
  },
};

export function formatPaise(amountPaise: number): string {
  return Money.formatRupees(Money.fromPaise(amountPaise));
}

// Admin forms take rupees ("499" or "499.50"); parsed as text so no floating-point value is involved.
export function rupeesTextToPaise(text: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (match === null) return null;
  const [, rupees = '0', fraction = ''] = match;
  return Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
}

export function paiseToRupeesText(amountPaise: number): string {
  const rupees = Math.trunc(amountPaise / 100);
  const fraction = amountPaise % 100;
  return fraction === 0 ? String(rupees) : `${String(rupees)}.${String(fraction).padStart(2, '0')}`;
}
