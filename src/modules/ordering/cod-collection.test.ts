import { describe, expect, it } from 'vitest';

import { codAmountsByShipment } from './cod-collection';

const line = (lineTotalPaise: number, shipmentQuantity: number, orderedQuantity: number) => ({
  lineTotalPaise,
  shipmentQuantity,
  orderedQuantity,
});

describe('codAmountsByShipment', () => {
  it('gives a single shipment the whole order total, fees included', () => {
    const amounts = codAmountsByShipment(82_800, [
      { shipmentId: 'a', lines: [line(79_900, 1, 1)] },
    ]);
    expect(Object.fromEntries(amounts)).toEqual({ a: 82_800 });
  });

  it('splits by the value of the goods in each package and adds up to the total exactly', () => {
    const amounts = codAmountsByShipment(162_700, [
      { shipmentId: 'b', lines: [line(159_800, 1, 2)] },
      { shipmentId: 'a', lines: [line(159_800, 1, 2)] },
    ]);
    expect(Object.fromEntries(amounts)).toEqual({ a: 81_350, b: 81_350 });
  });

  it('puts the rounding remainder on the last shipment by id', () => {
    const amounts = codAmountsByShipment(100_001, [
      { shipmentId: 'a', lines: [line(30_000, 1, 1)] },
      { shipmentId: 'b', lines: [line(30_000, 1, 1)] },
      { shipmentId: 'c', lines: [line(30_000, 1, 1)] },
    ]);
    expect(Object.fromEntries(amounts)).toEqual({ a: 33_333, b: 33_333, c: 33_335 });
    expect([...amounts.values()].reduce((total, amount) => total + amount, 0)).toBe(100_001);
  });

  it('weights unequal packages and handles goods worth nothing', () => {
    expect(
      Object.fromEntries(
        codAmountsByShipment(40_000, [
          { shipmentId: 'a', lines: [line(30_000, 3, 4)] },
          { shipmentId: 'b', lines: [line(30_000, 1, 4)] },
        ]),
      ),
    ).toEqual({ a: 30_000, b: 10_000 });
    expect(
      Object.fromEntries(
        codAmountsByShipment(0, [
          { shipmentId: 'a', lines: [line(0, 1, 1)] },
          { shipmentId: 'b', lines: [line(0, 1, 1)] },
        ]),
      ),
    ).toEqual({ a: 0, b: 0 });
  });

  it('stays exact for very large totals', () => {
    const amounts = codAmountsByShipment(999_999_999, [
      { shipmentId: 'a', lines: [line(999_999_999, 1, 3)] },
      { shipmentId: 'b', lines: [line(999_999_999, 2, 3)] },
    ]);
    expect(Object.fromEntries(amounts)).toEqual({ a: 333_333_333, b: 666_666_666 });
  });
});
