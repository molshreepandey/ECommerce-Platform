import { Money, type Paise } from '@/lib/money';

export interface CodShipmentGoods {
  shipmentId: string;
  lines: readonly { lineTotalPaise: number; shipmentQuantity: number; orderedQuantity: number }[];
}

function goodsValuePaise(shipment: CodShipmentGoods): bigint {
  return shipment.lines.reduce(
    (total, line) =>
      total +
      (BigInt(line.lineTotalPaise) * BigInt(line.shipmentQuantity)) / BigInt(line.orderedQuantity),
    0n,
  );
}

// D35: a split Cash on Delivery order is paid package by package. Each live shipment collects a share of
// the order total in proportion to the value of its goods; the last shipment (by id) takes the rounding
// remainder, so the shares add up to the total exactly and no package asks for the whole amount again.
export function codAmountsByShipment(
  orderTotalPaise: number,
  shipments: readonly CodShipmentGoods[],
): Map<string, Paise> {
  const ordered = [...shipments].sort((left, right) =>
    left.shipmentId.localeCompare(right.shipmentId),
  );
  const values = ordered.map(goodsValuePaise);
  const totalValue = values.reduce((total, value) => total + value, 0n);
  const amounts = new Map<string, Paise>();
  let assignedPaise = 0;
  ordered.forEach((shipment, index) => {
    const isLast = index === ordered.length - 1;
    const sharePaise = isLast
      ? orderTotalPaise - assignedPaise
      : totalValue === 0n
        ? 0
        : Number((BigInt(orderTotalPaise) * (values[index] ?? 0n)) / totalValue);
    assignedPaise += sharePaise;
    amounts.set(shipment.shipmentId, Money.fromPaise(sharePaise));
  });
  return amounts;
}
