import { createHash } from 'node:crypto';

import type { DatabaseClient } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { findPurchasableVariants } from '@/modules/catalogue/purchasable-variant.service';
import { findServiceableCouriers } from '@/modules/fulfilment/courier-serviceability.service';
import { selectCourier } from '@/modules/fulfilment/courier-selection';
import type { StaffContext, RequestMetadata } from '@/modules/identity/access-control';
import { allocateOrder, warehouseOrderFor } from '@/modules/inventory/allocation';
import { loadStoreSettings } from '@/modules/pricing/store-settings.service';
import { findAllocatableStock } from '@/modules/inventory/inventory-query.service';
import { applyReservationChanges } from '@/modules/inventory/reservation.service';

import { updatePaymentStatusIfCurrent } from './order-lifecycle.repository';
import {
  insertOrderIfNew,
  insertOrderItems,
  insertPayment,
  insertShipmentItems,
  insertShipments,
  insertStatusHistory,
  nextOrderNumber,
} from './order.repository';
import { orderingErrors } from './ordering.errors';

// D43 exchange: a replacement order for the chosen variants, fully discounted (the customer already
// paid), allocated and reserved like a checkout. Runs inside the caller's transaction after the return
// request lock; the idempotency key is derived from the return request, so it can never be created twice.
export async function createExchangeOrder(
  transaction: DatabaseClient,
  input: {
    returnRequestId: string;
    customerId: string;
    shippingAddress: Record<string, string | null>;
    lines: readonly { variantId: string; quantity: number }[];
    staff: StaffContext;
    metadata: RequestMetadata;
  },
): Promise<{ orderId: string; orderNumber: string }> {
  const variants = await findPurchasableVariants(
    input.lines.map(({ variantId }) => variantId),
    transaction,
  );
  const pincode = input.shippingAddress['pincode'] ?? '';
  const courier = selectCourier({
    couriers: await findServiceableCouriers(transaction, pincode),
    paymentMethod: 'ONLINE',
    orderTotalPaise: 0,
  });
  if (!courier.isServiceable) {
    throw orderingErrors.pincodeNotServiceable(
      courier.reason,
      'The delivery pincode is no longer serviceable.',
    );
  }
  const { allocationStrategy } = await loadStoreSettings(transaction);
  const allocation = allocateOrder(
    input.lines,
    await findAllocatableStock(
      transaction,
      input.lines.map(({ variantId }) => variantId),
    ),
    warehouseOrderFor(allocationStrategy, pincode),
  );
  if (!allocation.isAllocated) throw orderingErrors.outOfStock(allocation.shortLines);

  const items = input.lines.map((line) => {
    const variant = variants.get(line.variantId);
    if (variant === undefined || !variant.isSellable) {
      throw new DomainError({
        kind: 'CONFLICT',
        code: 'EXCHANGE_VARIANT_UNAVAILABLE',
        message: 'The replacement is no longer available.',
      });
    }
    return { line, variant };
  });
  const subtotalPaise = items.reduce(
    (total, { line, variant }) => total + variant.unitPricePaise * line.quantity,
    0,
  );
  const orderNumber = await nextOrderNumber(transaction);
  const order = await insertOrderIfNew(transaction, {
    orderNumber,
    customerId: input.customerId,
    idempotencyKey: `exchange-${input.returnRequestId}`,
    requestFingerprint: createHash('sha256').update(input.returnRequestId).digest('hex'),
    paymentMethod: 'COD',
    subtotalPaise,
    discountPaise: subtotalPaise,
    taxPaise: 0,
    shippingFeePaise: 0,
    codFeePaise: 0,
    totalPaise: 0,
    shippingAddress: input.shippingAddress,
    couponCode: null,
    metadata: { exchangeForReturnRequestId: input.returnRequestId },
  });
  if (order === null) {
    throw new DomainError({
      kind: 'CONFLICT',
      code: 'EXCHANGE_EXISTS',
      message: 'An exchange order already exists.',
    });
  }
  const orderItems = await insertOrderItems(
    transaction,
    order.id,
    items.map(({ line, variant }) => ({
      variantId: variant.variantId,
      productId: variant.productId,
      productName: variant.productName,
      brandName: variant.brandName,
      sku: variant.sku,
      optionValues: variant.optionValues,
      imageUrl: variant.imageUrl,
      quantity: line.quantity,
      mrpPaise: variant.mrpPaise,
      unitPricePaise: variant.unitPricePaise,
      taxRateBasisPoints: variant.taxRateBasisPoints,
      taxPaise: 0,
      lineTotalPaise: variant.unitPricePaise * line.quantity,
      weightGrams: variant.weightGrams,
      lengthMm: variant.lengthMm,
      breadthMm: variant.breadthMm,
      heightMm: variant.heightMm,
      categoryId: variant.category?.id ?? null,
      categoryPath: variant.category?.path ?? null,
      categoryName: variant.category?.name ?? null,
      productGroupId: variant.productGroupId,
    })),
  );
  const orderItemIdByVariant = new Map(orderItems.map((item) => [item.variantId, item.id]));
  const shipments = await insertShipments(
    transaction,
    allocation.warehouseIds.map((warehouseId) => ({
      orderId: order.id,
      warehouseId,
      courierPartnerId: courier.courier.courierPartnerId,
    })),
  );
  const shipmentIdByWarehouse = new Map(
    shipments.map((shipment) => [shipment.warehouseId, shipment.id]),
  );
  const lines = allocation.lines.map((line) => ({
    ...line,
    shipmentId: shipmentIdByWarehouse.get(line.warehouseId) ?? '',
    orderItemId: orderItemIdByVariant.get(line.variantId) ?? '',
  }));
  await insertShipmentItems(
    transaction,
    lines.map(({ shipmentId, orderItemId, quantity }) => ({ shipmentId, orderItemId, quantity })),
  );
  await insertPayment(transaction, { orderId: order.id, paymentMethod: 'COD', amountPaise: 0 });
  await updatePaymentStatusIfCurrent(
    transaction,
    order.id,
    'PENDING',
    'COLLECTED',
    new Date(),
    `exchange:${input.returnRequestId}`,
  );
  await insertStatusHistory(transaction, {
    orderId: order.id,
    fromStatus: null,
    toStatus: 'PLACED',
    actorType: 'STAFF',
    actorId: input.staff.staffUserId,
    reason: 'Exchange replacement',
  });
  await applyReservationChanges(
    transaction,
    { kind: 'STAFF', staff: input.staff, metadata: input.metadata },
    {
      reserve: lines.map(({ shipmentId, variantId, warehouseId, quantity }) => ({
        shipmentId,
        variantId,
        warehouseId,
        quantity,
      })),
    },
  );
  return { orderId: order.id, orderNumber };
}
