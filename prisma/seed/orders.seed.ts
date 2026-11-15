import { createHash } from 'node:crypto';
import type {
  ActorType,
  InventoryMovementType,
  OrderStatus,
  PaymentStatus,
  ShipmentStatus,
} from '../../src/generated/prisma/enums';
import type { SeededVariant } from './catalogue.seed';
import type { SeededCourierPartner } from './fulfilment.seed';
import type { DemoCustomerKey, SeededAddress, SeededCustomer } from './identity.seed';
import type { OrderScenario, ShipmentScenario } from './order-scenarios';
import {
  orderScenarios,
  orderStatusOffsetHours,
  shipmentStatusOffsetHours,
} from './order-scenarios';
import { seededStoreSettings } from './settings.seed';
import type { SeedClient } from './seed-client';
import { addHours, daysFromSeedDay } from './seed-clock';
import { deterministicUuidV7, requireValue } from './seed-ids';
import type { WarehouseCode } from './warehouses.seed';

export interface InventoryEvent {
  occurredAt: Date;
  sku: string;
  warehouseCode: WarehouseCode;
  movementType: InventoryMovementType;
  onHandDelta: number;
  reservedDelta: number;
  referenceType: string;
  referenceId: string;
  actorType: ActorType;
}

export interface SeedOrdersInput {
  customerByKey: Map<DemoCustomerKey, SeededCustomer>;
  variantBySku: Map<string, SeededVariant>;
  warehouseIdByCode: Map<WarehouseCode, string>;
  courierPartners: SeededCourierPartner[];
  couponIdByCode: Map<string, string>;
}

interface PricedLine {
  orderItemId: string;
  variant: SeededVariant;
  quantity: number;
  lineTotalPaise: number;
  taxPaise: number;
}

interface PricedOrder {
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  shippingFeePaise: number;
  codFeePaise: number;
  totalPaise: number;
}

const couponPercentDiscounts: Record<string, { percent: number; maxDiscountPaise: number }> = {
  SAVE10: { percent: 10, maxDiscountPaise: 20000 },
};

function includedTaxPaise(lineTotalPaise: number, taxRateBasisPoints: number): number {
  return Math.round((lineTotalPaise * taxRateBasisPoints) / (10000 + taxRateBasisPoints));
}

function couponDiscountPaise(couponCode: string | null, subtotalPaise: number): number {
  if (!couponCode) {
    return 0;
  }
  const coupon = requireValue(couponPercentDiscounts[couponCode], `coupon rule ${couponCode}`);
  return Math.min(Math.floor((subtotalPaise * coupon.percent) / 100), coupon.maxDiscountPaise);
}

function priceOrder(lines: PricedLine[], couponCode: string | null): PricedOrder {
  const subtotalPaise = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  const discountPaise = couponDiscountPaise(couponCode, subtotalPaise);
  const shippingFeePaise =
    subtotalPaise - discountPaise >= seededStoreSettings.free_shipping_threshold_paise
      ? 0
      : seededStoreSettings.shipping_fee_paise;
  const codFeePaise = seededStoreSettings.cod_fee_paise;
  return {
    subtotalPaise,
    discountPaise,
    taxPaise: lines.reduce((sum, line) => sum + line.taxPaise, 0),
    shippingFeePaise,
    codFeePaise,
    totalPaise: subtotalPaise - discountPaise + shippingFeePaise + codFeePaise,
  };
}

function addressFor(
  customer: SeededCustomer,
  addressKey: OrderScenario['addressKey'],
): SeededAddress {
  if (addressKey === 'default') {
    return customer.defaultAddress;
  }
  return requireValue(
    customer.addresses.find((address) => address.id !== customer.defaultAddress.id),
    'secondary address',
  );
}

function courierFor(
  courierPartners: SeededCourierPartner[],
  pincode: string,
): SeededCourierPartner {
  const servingCouriers = courierPartners.filter((courierPartner) =>
    courierPartner.serviceablePincodes.has(pincode),
  );
  servingCouriers.sort((first, second) => first.priority - second.priority);
  return requireValue(servingCouriers[0], `courier for pincode ${pincode}`);
}

function lastStatusOf<Status>(statusPath: readonly Status[]): Status {
  return requireValue(statusPath.at(-1), 'status path');
}

function paymentStatusFor(orderStatus: OrderStatus): PaymentStatus {
  switch (orderStatus) {
    case 'DELIVERED':
      return 'COLLECTED';
    case 'CANCELLED':
      return 'VOIDED';
    case 'RTO':
      return 'FAILED';
    case 'PLACED':
    case 'CONFIRMED':
    case 'PROCESSING':
    case 'PARTIALLY_SHIPPED':
    case 'SHIPPED':
    case 'PARTIALLY_DELIVERED':
      return 'PENDING';
  }
}

function orderStatusActor(toStatus: OrderStatus, fromStatus: OrderStatus | null): ActorType {
  if (toStatus === 'PLACED' || (toStatus === 'CANCELLED' && fromStatus === 'PLACED')) {
    return 'CUSTOMER';
  }
  if (toStatus === 'DELIVERED' || toStatus === 'PARTIALLY_DELIVERED' || toStatus === 'RTO') {
    return 'COURIER';
  }
  return 'STAFF';
}

function cancellationReason(fromStatus: OrderStatus | null): string {
  return fromStatus === 'PLACED' ? 'Ordered by mistake' : 'Customer asked to cancel over phone';
}

function shipmentStatusTime(
  placedAt: Date,
  statusPath: readonly ShipmentStatus[],
  status: ShipmentStatus,
): Date | null {
  return statusPath.includes(status) ? addHours(placedAt, shipmentStatusOffsetHours[status]) : null;
}

function trackingLocation(
  status: ShipmentStatus,
  originCity: string,
  destinationCity: string,
): string {
  return status === 'SHIPPED' || status === 'RTO_RECEIVED' ? originCity : destinationCity;
}

const trackingDescriptions: Partial<Record<ShipmentStatus, string>> = {
  SHIPPED: 'Picked up and in transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered to customer, cash collected',
  DELIVERY_FAILED: 'Delivery attempted, customer refused COD',
  RTO_INITIATED: 'Return to origin initiated',
  RTO_RECEIVED: 'Returned to origin warehouse',
};

const warehouseCities: Record<WarehouseCode, string> = {
  'WH-BLR': 'Bengaluru',
  'WH-DEL': 'New Delhi',
  'WH-MUM': 'Bhiwandi',
};

function inventoryEventsForShipment(
  shipmentScenario: ShipmentScenario,
  shipmentId: string,
  placedAt: Date,
): InventoryEvent[] {
  const events: InventoryEvent[] = [];
  for (const line of shipmentScenario.lines) {
    const baseEvent = {
      sku: line.sku,
      warehouseCode: shipmentScenario.warehouseCode,
      referenceType: 'shipment',
      referenceId: shipmentId,
    };
    events.push({
      ...baseEvent,
      occurredAt: placedAt,
      movementType: 'RESERVE',
      onHandDelta: 0,
      reservedDelta: line.quantity,
      actorType: 'CUSTOMER',
    });

    const cancelledAt = shipmentStatusTime(placedAt, shipmentScenario.statusPath, 'CANCELLED');
    if (cancelledAt) {
      events.push({
        ...baseEvent,
        occurredAt: cancelledAt,
        movementType: 'RELEASE',
        onHandDelta: 0,
        reservedDelta: -line.quantity,
        actorType: 'STAFF',
      });
    }
    const shippedAt = shipmentStatusTime(placedAt, shipmentScenario.statusPath, 'SHIPPED');
    if (shippedAt) {
      events.push({
        ...baseEvent,
        occurredAt: shippedAt,
        movementType: 'DISPATCH',
        onHandDelta: -line.quantity,
        reservedDelta: -line.quantity,
        actorType: 'STAFF',
      });
    }
    const rtoReceivedAt = shipmentStatusTime(placedAt, shipmentScenario.statusPath, 'RTO_RECEIVED');
    if (rtoReceivedAt) {
      events.push({
        ...baseEvent,
        occurredAt: rtoReceivedAt,
        movementType: 'RTO_RESTOCK',
        onHandDelta: line.quantity,
        reservedDelta: 0,
        actorType: 'STAFF',
      });
    }
  }
  return events;
}

async function seedOrderHeader(
  client: SeedClient,
  scenario: OrderScenario,
  input: SeedOrdersInput,
  placedAt: Date,
  lines: PricedLine[],
): Promise<{ orderId: string; customerId: string; address: SeededAddress; totals: PricedOrder }> {
  const customer = requireValue(
    input.customerByKey.get(scenario.customerKey),
    `customer ${scenario.customerKey}`,
  );
  const address = addressFor(customer, scenario.addressKey);
  const totals = priceOrder(lines, scenario.couponCode);
  const orderStatus = lastStatusOf(scenario.statusPath);
  const orderFields = {
    status: orderStatus,
    paymentMethod: 'COD' as const,
    ...totals,
    shippingAddress: {
      recipientName: address.recipientName,
      phone: address.phone,
      addressLine1: address.addressLine1,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
    },
    couponCode: scenario.couponCode,
    placedAt,
  };
  const order = await client.order.upsert({
    where: { orderNumber: scenario.orderNumber },
    create: {
      orderNumber: scenario.orderNumber,
      customerId: customer.id,
      idempotencyKey: `seed-${scenario.orderNumber}`,
      requestFingerprint: createHash('sha256').update(scenario.orderNumber).digest('hex'),
      createdAt: placedAt,
      ...orderFields,
    },
    update: orderFields,
    select: { id: true },
  });
  return { orderId: order.id, customerId: customer.id, address, totals };
}

async function seedOrderItems(
  client: SeedClient,
  orderId: string,
  lines: PricedLine[],
  placedAt: Date,
): Promise<void> {
  for (const line of lines) {
    const snapshot = await client.productVariant.findUniqueOrThrow({
      where: { id: line.variant.id },
      select: {
        weightGrams: true,
        lengthMm: true,
        breadthMm: true,
        heightMm: true,
        product: {
          select: {
            productGroupId: true,
            category: { select: { id: true, name: true, path: true } },
          },
        },
      },
    });
    const itemFields = {
      weightGrams: snapshot.weightGrams,
      lengthMm: snapshot.lengthMm,
      breadthMm: snapshot.breadthMm,
      heightMm: snapshot.heightMm,
      categoryId: snapshot.product.category?.id ?? null,
      categoryPath: snapshot.product.category?.path ?? null,
      categoryName: snapshot.product.category?.name ?? null,
      productGroupId: snapshot.product.productGroupId,
      variantId: line.variant.id,
      productId: line.variant.productId,
      productName: line.variant.productName,
      brandName: line.variant.brandName,
      sku: line.variant.sku,
      optionValues: line.variant.optionValues,
      imageUrl: line.variant.imageUrl,
      quantity: line.quantity,
      mrpPaise: line.variant.mrpPaise,
      unitPricePaise: line.variant.pricePaise,
      taxRateBasisPoints: line.variant.taxRateBasisPoints,
      taxPaise: line.taxPaise,
      lineTotalPaise: line.lineTotalPaise,
    };
    await client.orderItem.upsert({
      where: { id: line.orderItemId },
      create: { id: line.orderItemId, orderId, createdAt: placedAt, ...itemFields },
      update: itemFields,
    });
  }
}

async function seedOrderStatusHistory(
  client: SeedClient,
  scenario: OrderScenario,
  orderId: string,
  customerId: string,
  placedAt: Date,
): Promise<void> {
  await client.orderStatusHistory.createMany({
    data: scenario.statusPath.map((toStatus, stepIndex) => {
      const fromStatus = stepIndex === 0 ? null : (scenario.statusPath[stepIndex - 1] ?? null);
      const actorType = orderStatusActor(toStatus, fromStatus);
      const createdAt = addHours(placedAt, orderStatusOffsetHours[toStatus]);
      return {
        id: deterministicUuidV7(`order-status:${scenario.orderNumber}:${toStatus}`, createdAt),
        orderId,
        fromStatus,
        toStatus,
        actorType,
        actorId: actorType === 'CUSTOMER' ? customerId : null,
        reason: toStatus === 'CANCELLED' ? cancellationReason(fromStatus) : null,
        createdAt,
      };
    }),
    skipDuplicates: true,
  });
}

async function seedShipment(
  client: SeedClient,
  scenario: OrderScenario,
  shipmentIndex: number,
  context: {
    orderId: string;
    placedAt: Date;
    address: SeededAddress;
    lines: PricedLine[];
    input: SeedOrdersInput;
  },
): Promise<InventoryEvent[]> {
  const shipmentScenario = requireValue(scenario.shipments[shipmentIndex], 'shipment scenario');
  const { placedAt, address, input } = context;
  const shipmentId = deterministicUuidV7(
    `shipment:${scenario.orderNumber}:${shipmentIndex}`,
    placedAt,
  );
  const statusPath = shipmentScenario.statusPath;
  const hasAwb = statusPath.includes('READY_TO_SHIP');
  const awbNumber = hasAwb
    ? `DMO${scenario.orderNumber.replace('ORD-', '')}${shipmentIndex + 1}`
    : null;
  const shipmentFields = {
    status: lastStatusOf(statusPath),
    warehouseId: requireValue(
      input.warehouseIdByCode.get(shipmentScenario.warehouseCode),
      `warehouse ${shipmentScenario.warehouseCode}`,
    ),
    courierPartnerId: courierFor(input.courierPartners, address.pincode).id,
    awbNumber,
    providerShipmentId: awbNumber ? `demo-${awbNumber}` : null,
    deliveryAttemptCount: statusPath.filter((status) => status === 'OUT_FOR_DELIVERY').length,
    packedAt: shipmentStatusTime(placedAt, statusPath, 'PACKED'),
    shippedAt: shipmentStatusTime(placedAt, statusPath, 'SHIPPED'),
    deliveredAt: shipmentStatusTime(placedAt, statusPath, 'DELIVERED'),
    cancelledAt: shipmentStatusTime(placedAt, statusPath, 'CANCELLED'),
    rtoReceivedAt: shipmentStatusTime(placedAt, statusPath, 'RTO_RECEIVED'),
  };
  await client.shipment.upsert({
    where: { id: shipmentId },
    create: { id: shipmentId, orderId: context.orderId, createdAt: placedAt, ...shipmentFields },
    update: shipmentFields,
  });

  for (const shipmentLine of shipmentScenario.lines) {
    const orderItem = requireValue(
      context.lines.find((line) => line.variant.sku === shipmentLine.sku),
      `order line ${shipmentLine.sku}`,
    );
    const shipmentItemId = deterministicUuidV7(
      `shipment-item:${scenario.orderNumber}:${shipmentIndex}:${shipmentLine.sku}`,
      placedAt,
    );
    await client.shipmentItem.upsert({
      where: { id: shipmentItemId },
      create: {
        id: shipmentItemId,
        shipmentId,
        orderItemId: orderItem.orderItemId,
        quantity: shipmentLine.quantity,
        createdAt: placedAt,
      },
      update: { quantity: shipmentLine.quantity },
    });
  }

  if (awbNumber) {
    const trackedStatuses = statusPath.filter(
      (status) => trackingDescriptions[status] !== undefined,
    );
    await client.shipmentTrackingEvent.createMany({
      data: trackedStatuses.map((status) => {
        const occurredAt = addHours(placedAt, shipmentStatusOffsetHours[status]);
        return {
          id: deterministicUuidV7(`tracking:${awbNumber}:${status}`, occurredAt),
          shipmentId,
          providerEventId: `${awbNumber}-${status}`,
          status,
          description: trackingDescriptions[status] ?? '',
          location: trackingLocation(
            status,
            warehouseCities[shipmentScenario.warehouseCode],
            address.city,
          ),
          occurredAt,
          createdAt: occurredAt,
        };
      }),
      skipDuplicates: true,
    });
  }

  return inventoryEventsForShipment(shipmentScenario, shipmentId, placedAt);
}

async function seedPayment(
  client: SeedClient,
  scenario: OrderScenario,
  orderId: string,
  totalPaise: number,
  placedAt: Date,
): Promise<void> {
  const orderStatus = lastStatusOf(scenario.statusPath);
  const statusChangedAt = addHours(placedAt, orderStatusOffsetHours[orderStatus]);
  const paymentStatus = paymentStatusFor(orderStatus);
  const paymentFields = {
    paymentMethod: 'COD' as const,
    status: paymentStatus,
    amountPaise: totalPaise,
    collectedAt: paymentStatus === 'COLLECTED' ? statusChangedAt : null,
    failedAt: paymentStatus === 'FAILED' ? statusChangedAt : null,
    voidedAt: paymentStatus === 'VOIDED' ? statusChangedAt : null,
  };
  await client.payment.upsert({
    where: { orderId },
    create: { orderId, createdAt: placedAt, ...paymentFields },
    update: paymentFields,
  });
}

async function seedOrderExtras(
  client: SeedClient,
  scenario: OrderScenario,
  context: {
    orderId: string;
    customerId: string;
    placedAt: Date;
    lines: PricedLine[];
    discountPaise: number;
    input: SeedOrdersInput;
  },
): Promise<void> {
  if (scenario.couponCode) {
    const couponId = requireValue(
      context.input.couponIdByCode.get(scenario.couponCode),
      `coupon ${scenario.couponCode}`,
    );
    await client.couponRedemption.upsert({
      where: { orderId: context.orderId },
      create: {
        couponId,
        customerId: context.customerId,
        orderId: context.orderId,
        discountPaise: context.discountPaise,
        createdAt: context.placedAt,
      },
      update: { discountPaise: context.discountPaise },
    });
  }

  const firstLine = context.lines[0];
  if (scenario.reviewRating !== null && firstLine) {
    const reviewFields = {
      rating: scenario.reviewRating,
      title: 'Verified purchase',
      body: `Rated ${scenario.reviewRating} out of 5 after delivery.`,
    };
    await client.review.upsert({
      where: { orderItemId: firstLine.orderItemId },
      create: {
        productId: firstLine.variant.productId,
        customerId: context.customerId,
        orderItemId: firstLine.orderItemId,
        createdAt: addHours(context.placedAt, orderStatusOffsetHours.DELIVERED + 24),
        ...reviewFields,
      },
      update: reviewFields,
    });
  }
}

function priceScenarioLines(
  scenario: OrderScenario,
  variantBySku: Map<string, SeededVariant>,
  placedAt: Date,
): PricedLine[] {
  return scenario.shipments.flatMap((shipment) =>
    shipment.lines.map((line) => {
      const variant = requireValue(variantBySku.get(line.sku), `variant ${line.sku}`);
      const lineTotalPaise = variant.pricePaise * line.quantity;
      return {
        orderItemId: deterministicUuidV7(
          `order-item:${scenario.orderNumber}:${line.sku}`,
          placedAt,
        ),
        variant,
        quantity: line.quantity,
        lineTotalPaise,
        taxPaise: includedTaxPaise(lineTotalPaise, variant.taxRateBasisPoints),
      };
    }),
  );
}

export async function seedOrders(
  client: SeedClient,
  input: SeedOrdersInput,
): Promise<InventoryEvent[]> {
  const inventoryEvents: InventoryEvent[] = [];
  for (const [scenarioIndex, scenario] of orderScenarios.entries()) {
    const placedAt = addHours(daysFromSeedDay(-scenario.placedDaysAgo), 0.5 + scenarioIndex / 60);
    const lines = priceScenarioLines(scenario, input.variantBySku, placedAt);
    const { orderId, customerId, address, totals } = await seedOrderHeader(
      client,
      scenario,
      input,
      placedAt,
      lines,
    );
    await seedOrderItems(client, orderId, lines, placedAt);
    await seedOrderStatusHistory(client, scenario, orderId, customerId, placedAt);
    for (const shipmentIndex of scenario.shipments.keys()) {
      inventoryEvents.push(
        ...(await seedShipment(client, scenario, shipmentIndex, {
          orderId,
          placedAt,
          address,
          lines,
          input,
        })),
      );
    }
    await seedPayment(client, scenario, orderId, totals.totalPaise, placedAt);
    await seedOrderExtras(client, scenario, {
      orderId,
      customerId,
      placedAt,
      lines,
      discountPaise: totals.discountPaise,
      input,
    });
  }

  for (const [couponCode, couponId] of input.couponIdByCode) {
    const seededRedemptionCount = orderScenarios.filter(
      (scenario) => scenario.couponCode === couponCode,
    ).length;
    if (seededRedemptionCount > 0) {
      await client.coupon.update({
        where: { id: couponId },
        data: { usedCount: seededRedemptionCount },
      });
    }
  }

  const highestSeededOrderNumber = Math.max(
    ...orderScenarios.map((scenario) => Number(scenario.orderNumber.replace('ORD-', ''))),
  );
  await client.$queryRaw`SELECT setval('order_number_seq', GREATEST(${highestSeededOrderNumber}::bigint, (SELECT last_value FROM order_number_seq)))`;
  return inventoryEvents;
}
