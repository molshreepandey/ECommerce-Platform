import { createHash } from 'node:crypto';

import { canonicalJson } from '@/lib/canonical-json';
import { type DatabaseClient, getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { customerIdSchema } from '@/lib/ids';
import { enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import {
  emptyCartAfterOrder,
  evaluateCouponForCustomer,
  type LineContext,
  loadCheckoutLineContext,
  lockCartForCheckout,
  readCartForCheckout,
} from '@/modules/cart/cart.service';
import type { StoredCartLine } from '@/modules/cart/cart.repository';
import type { PurchasableVariant } from '@/modules/catalogue/purchasable-variant.service';
import { findServiceableCouriers } from '@/modules/fulfilment/courier-serviceability.service';
import { type CourierSelection, selectCourier } from '@/modules/fulfilment/courier-selection';
import type { CustomerContext, RequestMetadata } from '@/modules/identity/access-control';
import type { AddressRow } from '@/modules/identity/address.repository';
import { findCustomerAddress } from '@/modules/identity/address.service';
import { isCustomerBlocked } from '@/modules/identity/customer-account.service';
import { allocateOrder, warehouseOrderFor } from '@/modules/inventory/allocation';
import { findAllocatableStock } from '@/modules/inventory/inventory-query.service';
import { applyReservationChanges } from '@/modules/inventory/reservation.service';
import type { CouponEvaluation } from '@/modules/pricing/coupon-rules';
import { findCouponForCheckout, redeemCoupon } from '@/modules/pricing/coupon.service';
import { type PriceBreakdown, priceOrder } from '@/modules/pricing/pricing';
import type { StoreSettings } from '@/modules/pricing/store-settings.schema';
import { loadStoreSettings } from '@/modules/pricing/store-settings.service';
import { recordOrderNotification } from '@/modules/notifications/notification.service';
import { countOpenUnpaidOnlineOrders } from '@/modules/payment/payment.repository';
import {
  maximumOpenUnpaidOnlineOrders,
  onlinePaymentWindowMinutes,
} from '@/modules/payment/payment.schema';
import { isSimulatedGatewayAvailable } from '@/modules/payment/simulated-gateway';

import type { CheckoutPaymentMethod, PlaceOrderInput } from './checkout.schema';
import {
  findOrderByIdempotencyKey,
  insertOrderIfNew,
  insertOrderItems,
  insertPayment,
  insertShipmentItems,
  insertShipments,
  insertStatusHistory,
  type NewOrderItem,
  nextOrderNumber,
} from './order.repository';
import { orderingErrors } from './ordering.errors';

// The largest amount an order row can hold (PostgreSQL integer, paise): about ₹2.1 crore.
const maximumOrderAmountPaise = 2_147_483_647;
const checkoutTransactionOptions = { maxWait: 5_000, timeout: 15_000 } as const;

export interface PlacedOrder {
  orderId: string;
  orderNumber: string;
  paymentMethod: CheckoutPaymentMethod;
  isReplay: boolean;
}

export interface CheckoutQuote {
  breakdown: PriceBreakdown;
  coupon: { code: string; isApplied: boolean; message: string | null } | null;
  courier: CourierSelection | null;
  codLimitPaise: number;
  codFeePaise: number;
  issues: { variantId: string; reason: string }[];
}

interface PricedCart {
  breakdown: PriceBreakdown;
  coupon: { couponId: string; code: string; evaluation: CouponEvaluation } | null;
}

function requestFingerprint(input: PlaceOrderInput): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function cartIssues(
  lines: readonly StoredCartLine[],
  context: LineContext,
): { variantId: string; reason: string }[] {
  return lines.flatMap((line) => {
    const variant = context.variants.get(line.variantId);
    if (variant === undefined || !variant.isSellable) {
      return [{ variantId: line.variantId, reason: 'UNAVAILABLE' }];
    }
    const availableQuantity = context.availability.get(line.variantId) ?? 0;
    return availableQuantity < line.quantity
      ? [
          {
            variantId: line.variantId,
            reason: availableQuantity === 0 ? 'OUT_OF_STOCK' : 'QUANTITY_EXCEEDS_STOCK',
          },
        ]
      : [];
  });
}

function sellableVariant(context: LineContext, variantId: string): PurchasableVariant {
  const variant = context.variants.get(variantId);
  if (variant === undefined) throw new Error('A checked cart line has no variant');
  return variant;
}

async function priceCart(
  database: DatabaseClient,
  input: {
    customerId: string;
    lines: readonly StoredCartLine[];
    context: LineContext;
    settings: StoreSettings;
    appliedCouponId: string | null;
    paymentMethod: CheckoutPaymentMethod;
  },
): Promise<PricedCart> {
  const pricingLines = input.lines.map((line) => {
    const variant = sellableVariant(input.context, line.variantId);
    return {
      lineKey: line.variantId,
      unitPricePaise: variant.unitPricePaise,
      quantity: line.quantity,
      taxRateBasisPoints: variant.taxRateBasisPoints,
    };
  });
  const subtotalPaise = pricingLines.reduce(
    (total, line) => total + line.unitPricePaise * line.quantity,
    0,
  );
  const couponRow =
    input.appliedCouponId === null
      ? null
      : await findCouponForCheckout(database, input.appliedCouponId);
  const coupon =
    couponRow === null
      ? null
      : {
          couponId: couponRow.id,
          code: couponRow.code,
          evaluation: await evaluateCouponForCustomer(
            database,
            couponRow,
            input.customerId,
            subtotalPaise,
          ),
        };
  const breakdown = priceOrder({
    lines: pricingLines,
    discountPaise: coupon?.evaluation.isApplicable === true ? coupon.evaluation.discountPaise : 0,
    fees: {
      shippingFeePaise: input.settings.shippingFeePaise,
      freeShippingThresholdPaise: input.settings.freeShippingThresholdPaise,
      codFeePaise: input.settings.codFeePaise,
    },
    paymentMethod: input.paymentMethod,
  });
  return { breakdown, coupon };
}

async function courierFor(
  database: DatabaseClient,
  address: AddressRow,
  paymentMethod: CheckoutPaymentMethod,
  orderTotalPaise: number,
): Promise<CourierSelection> {
  return selectCourier({
    couriers: await findServiceableCouriers(database, address.pincode),
    paymentMethod,
    orderTotalPaise,
  });
}

const serviceabilityMessages: Record<
  Exclude<CourierSelection, { isServiceable: true }>['reason'],
  string
> = {
  PINCODE_NOT_SERVICEABLE: 'We do not deliver to this pincode yet. Choose another address.',
  COD_NOT_AVAILABLE: 'Cash on Delivery is not available at this pincode. Pay online instead.',
  COD_LIMIT_EXCEEDED:
    'This order is above the Cash on Delivery limit for this pincode. Pay online instead.',
};

// The checkout page summary (plan /api/store/checkout/summary): the same pricing, coupon and courier rules
// as placing the order, without writing anything.
export async function quoteCheckout(
  customer: CustomerContext,
  input: { addressId?: string | undefined; paymentMethod: CheckoutPaymentMethod },
): Promise<CheckoutQuote> {
  const database = getDatabase();
  const { lines, appliedCouponId } = await readCartForCheckout(database, customer.customerId);
  const [context, settings] = await Promise.all([
    loadCheckoutLineContext(
      database,
      lines.map(({ variantId }) => variantId),
    ),
    loadStoreSettings(database),
  ]);
  const issues = cartIssues(lines, context);
  const sellableLines = lines.filter(
    (line) => context.variants.get(line.variantId)?.isSellable === true,
  );
  const priced = await priceCart(database, {
    customerId: customer.customerId,
    lines: sellableLines,
    context,
    settings,
    appliedCouponId,
    paymentMethod: input.paymentMethod,
  });
  const address =
    input.addressId === undefined
      ? null
      : await findCustomerAddress(database, customer.customerId, input.addressId);
  return {
    breakdown: priced.breakdown,
    coupon:
      priced.coupon === null
        ? null
        : {
            code: priced.coupon.code,
            isApplied: priced.coupon.evaluation.isApplicable,
            message: priced.coupon.evaluation.isApplicable
              ? null
              : priced.coupon.evaluation.message,
          },
    courier:
      address === null
        ? null
        : await courierFor(database, address, input.paymentMethod, priced.breakdown.totalPaise),
    codLimitPaise: settings.maxCodOrderValuePaise,
    codFeePaise: settings.codFeePaise,
    issues,
  };
}

function addressSnapshot(address: AddressRow): Record<string, string | null> {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    landmark: address.landmark,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
  };
}

function orderItemSnapshot(
  variant: PurchasableVariant,
  line: StoredCartLine,
  pricedLine: PriceBreakdown['lines'][number] | undefined,
): NewOrderItem {
  return {
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
    taxPaise: pricedLine?.taxPaise ?? 0,
    lineTotalPaise: variant.unitPricePaise * line.quantity,
    weightGrams: variant.weightGrams,
    lengthMm: variant.lengthMm,
    breadthMm: variant.breadthMm,
    heightMm: variant.heightMm,
    categoryId: variant.category?.id ?? null,
    categoryPath: variant.category?.path ?? null,
    categoryName: variant.category?.name ?? null,
    productGroupId: variant.productGroupId,
  };
}

function replayOrThrow(
  existing: {
    id: string;
    orderNumber: string;
    requestFingerprint: string;
    paymentMethod: CheckoutPaymentMethod;
  },
  fingerprint: string,
): PlacedOrder {
  if (existing.requestFingerprint !== fingerprint) throw orderingErrors.idempotencyKeyReused();
  return {
    orderId: existing.id,
    orderNumber: existing.orderNumber,
    paymentMethod: existing.paymentMethod,
    isReplay: true,
  };
}

// Plan §10A and C29–C31, in one transaction: the same key and request return the same order; the cart is
// re-priced and re-checked; COD rules, courier serviceability, allocation (§6), coupon guarded increment,
// order + items + shipments + payment + history + audit, reservation (TD-019 lock order) and the cart is
// emptied. Any refusal rolls everything back.
// The allocation read is unlocked, so a concurrent checkout can take a stock row between the read and
// the guarded reservation. That failure means the other checkout has committed: the whole transaction is
// rolled back and run again on fresh stock. Each retry follows another checkout's success, so the loop is
// bounded by the stock; after the last attempt the refusal is the normal 409 OUT_OF_STOCK.
class ReservationRaceError extends Error {
  constructor(readonly refusal: unknown) {
    super('A stock row changed between allocation and reservation');
    this.name = 'ReservationRaceError';
  }
}

const maximumCheckoutAttempts = 5;

export async function placeOrder(
  customer: CustomerContext,
  input: PlaceOrderInput,
  idempotencyKey: string,
  metadata: RequestMetadata,
): Promise<PlacedOrder> {
  if (input.paymentMethod === 'ONLINE' && !isSimulatedGatewayAvailable())
    throw orderingErrors.onlinePaymentUnavailable();
  await enforceRateLimit({ action: 'checkout', identifier: customer.customerId });
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await placeOrderOnce(customer, input, idempotencyKey, metadata);
    } catch (error) {
      if (!(error instanceof ReservationRaceError)) throw error;
      if (attempt >= maximumCheckoutAttempts) throw error.refusal;
    }
  }
}

async function placeOrderOnce(
  customer: CustomerContext,
  input: PlaceOrderInput,
  idempotencyKey: string,
  metadata: RequestMetadata,
): Promise<PlacedOrder> {
  const fingerprint = requestFingerprint(input);
  return getDatabase().$transaction(async (transaction) => {
    const cart = await lockCartForCheckout(transaction, customer.customerId);
    // After the cart lock, so a duplicate that waited for the first request sees its committed order.
    const existing = await findOrderByIdempotencyKey(
      transaction,
      customer.customerId,
      idempotencyKey,
    );
    if (existing !== null) return replayOrThrow(existing, fingerprint);
    if (await isCustomerBlocked(transaction, customer.customerId))
      throw orderingErrors.customerBlocked();
    if (cart.lines.length === 0) throw orderingErrors.cartEmpty();
    const address = await findCustomerAddress(transaction, customer.customerId, input.addressId);
    if (address === null) throw orderingErrors.addressNotFound();
    // Under the cart lock, so two parallel checkouts of one customer cannot both pass the cap.
    if (
      input.paymentMethod === 'ONLINE' &&
      (await countOpenUnpaidOnlineOrders(
        transaction,
        customer.customerId,
        new Date(Date.now() - onlinePaymentWindowMinutes * 60_000),
      )) >= maximumOpenUnpaidOnlineOrders
    ) {
      throw orderingErrors.unpaidOnlineOrdersLimit(maximumOpenUnpaidOnlineOrders);
    }

    const [context, settings] = await Promise.all([
      loadCheckoutLineContext(
        transaction,
        cart.lines.map(({ variantId }) => variantId),
      ),
      loadStoreSettings(transaction),
    ]);
    const issues = cartIssues(cart.lines, context);
    if (issues.length > 0) throw orderingErrors.cartLinesUnavailable(issues);

    const priced = await priceCart(transaction, {
      customerId: customer.customerId,
      lines: cart.lines,
      context,
      settings,
      appliedCouponId: cart.appliedCouponId,
      paymentMethod: input.paymentMethod,
    });
    if (priced.coupon !== null && !priced.coupon.evaluation.isApplicable) {
      throw orderingErrors.couponRejected(
        priced.coupon.evaluation.rejectionCode,
        priced.coupon.evaluation.message,
      );
    }
    const { breakdown } = priced;
    // Order amounts are int4 columns: refuse (422) rather than fail the insert (500) when a large line's
    // subtotal passes their range even though a coupon brings the total down.
    if (breakdown.subtotalPaise > maximumOrderAmountPaise) {
      throw orderingErrors.orderTooLarge(maximumOrderAmountPaise);
    }
    if (breakdown.totalPaise !== input.expectedTotalPaise)
      throw orderingErrors.priceChanged(breakdown);
    if (input.paymentMethod === 'COD' && breakdown.totalPaise > settings.maxCodOrderValuePaise) {
      throw orderingErrors.codLimitExceeded(settings.maxCodOrderValuePaise);
    }
    const courier = await courierFor(
      transaction,
      address,
      input.paymentMethod,
      breakdown.totalPaise,
    );
    if (!courier.isServiceable) {
      throw orderingErrors.pincodeNotServiceable(
        courier.reason,
        serviceabilityMessages[courier.reason],
      );
    }
    const allocation = allocateOrder(
      cart.lines.map(({ variantId, quantity }) => ({ variantId, quantity })),
      await findAllocatableStock(
        transaction,
        cart.lines.map(({ variantId }) => variantId),
      ),
      warehouseOrderFor(settings.allocationStrategy, address.pincode),
    );
    if (!allocation.isAllocated) throw orderingErrors.outOfStock(allocation.shortLines);

    const orderNumber = await nextOrderNumber(transaction);
    const order = await insertOrderIfNew(transaction, {
      orderNumber,
      customerId: customer.customerId,
      idempotencyKey,
      requestFingerprint: fingerprint,
      paymentMethod: input.paymentMethod,
      subtotalPaise: breakdown.subtotalPaise,
      discountPaise: breakdown.discountPaise,
      taxPaise: breakdown.taxPaise,
      shippingFeePaise: breakdown.shippingFeePaise,
      codFeePaise: breakdown.codFeePaise,
      totalPaise: breakdown.totalPaise,
      shippingAddress: addressSnapshot(address),
      couponCode: priced.coupon?.code ?? null,
      metadata: {
        courierPartnerId: courier.courier.courierPartnerId,
        estimatedDeliveryDays: courier.courier.etaDays,
      },
    });
    if (order === null) {
      const raced = await findOrderByIdempotencyKey(
        transaction,
        customer.customerId,
        idempotencyKey,
      );
      if (raced === null)
        throw new Error('An idempotency conflict was reported but no order is visible');
      return replayOrThrow(raced, fingerprint);
    }

    const pricedLineByVariant = new Map(breakdown.lines.map((line) => [line.lineKey, line]));
    const orderItems = await insertOrderItems(
      transaction,
      order.id,
      cart.lines.map((line) =>
        orderItemSnapshot(
          sellableVariant(context, line.variantId),
          line,
          pricedLineByVariant.get(line.variantId),
        ),
      ),
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
    const shipmentLines = allocation.lines.map((line) => {
      const shipmentId = shipmentIdByWarehouse.get(line.warehouseId);
      const orderItemId = orderItemIdByVariant.get(line.variantId);
      if (shipmentId === undefined || orderItemId === undefined) {
        throw new Error('An allocated line has no shipment or order item');
      }
      return { ...line, shipmentId, orderItemId };
    });
    await insertShipmentItems(
      transaction,
      shipmentLines.map(({ shipmentId, orderItemId, quantity }) => ({
        shipmentId,
        orderItemId,
        quantity,
      })),
    );
    await insertPayment(transaction, {
      orderId: order.id,
      paymentMethod: input.paymentMethod,
      amountPaise: breakdown.totalPaise,
    });
    if (priced.coupon !== null && breakdown.discountPaise > 0) {
      const redeemed = await redeemCoupon(transaction, {
        couponId: priced.coupon.couponId,
        customerId: customer.customerId,
        orderId: order.id,
        discountPaise: breakdown.discountPaise,
      });
      if (!redeemed) throw orderingErrors.couponExhausted();
    }
    await insertStatusHistory(transaction, {
      orderId: order.id,
      fromStatus: null,
      toStatus: 'PLACED',
      actorType: 'CUSTOMER',
      actorId: customer.customerId,
      reason: null,
    });
    await recordAuditEvent(transaction, {
      actorType: 'CUSTOMER',
      actorId: customer.customerId,
      action: 'order.placed',
      entityType: 'order',
      entityId: order.id,
      after: {
        orderNumber,
        paymentMethod: input.paymentMethod,
        totalPaise: breakdown.totalPaise,
        shipmentCount: shipments.length,
        couponCode: priced.coupon?.code ?? null,
      },
      ipAddress: metadata.clientIp,
      requestId: metadata.requestId,
    });
    await recordOrderNotification(transaction, {
      event: 'ORDER_PLACED',
      order: {
        id: order.id,
        orderNumber,
        paymentMethod: input.paymentMethod,
        totalPaise: breakdown.totalPaise,
        shippingPhone: address.phone,
      },
    });
    try {
      await applyReservationChanges(
        transaction,
        { kind: 'CUSTOMER', customerId: customerIdSchema.parse(customer.customerId), metadata },
        {
          reserve: shipmentLines.map(({ shipmentId, variantId, warehouseId, quantity }) => ({
            shipmentId,
            variantId,
            warehouseId,
            quantity,
          })),
        },
      );
    } catch (error) {
      if (error instanceof DomainError && error.code === 'OUT_OF_STOCK') {
        throw new ReservationRaceError(error);
      }
      throw error;
    }
    await emptyCartAfterOrder(transaction, cart.cartId);
    return {
      orderId: order.id,
      orderNumber,
      paymentMethod: input.paymentMethod,
      isReplay: false,
    };
  }, checkoutTransactionOptions);
}
