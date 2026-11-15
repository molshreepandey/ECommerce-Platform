import { type DatabaseClient, getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import {
  findPurchasableVariants,
  type PurchasableVariant,
} from '@/modules/catalogue/purchasable-variant.service';
import type { CustomerContext } from '@/modules/identity/access-control';
import { findAvailabilityForVariants } from '@/modules/inventory/inventory-query.service';
import { countPlacedOrdersForCustomer } from '@/modules/ordering/order-history.repository';
import { type CouponEvaluation, evaluateCoupon } from '@/modules/pricing/coupon-rules';
import {
  countCouponRedemptionsForCustomer,
  type CouponRow,
  findCouponByCode,
  findCouponById,
} from '@/modules/pricing/coupon.repository';
import { priceOrder } from '@/modules/pricing/pricing';
import type { StoreSettings } from '@/modules/pricing/store-settings.schema';
import { loadStoreSettings } from '@/modules/pricing/store-settings.service';

import { cartErrors } from './cart.errors';
import {
  countCartLines,
  deleteAllCartLines,
  deleteCartLine,
  ensureCustomerCart,
  findCartLineQuantity,
  findCustomerCart,
  lockCustomerCart,
  setAppliedCoupon,
  setCartLine,
  type StoredCartLine,
} from './cart.repository';
import { type AddCartItemInput, maximumCartLines, maximumQuantityPerLine } from './cart.schema';
import type { GuestCartLine } from './guest-cart';

export const lowStockWarningThreshold = 5;

export type CartLineWarning =
  | { kind: 'UNAVAILABLE' }
  | { kind: 'OUT_OF_STOCK' }
  | { kind: 'QUANTITY_EXCEEDS_STOCK'; availableQuantity: number }
  | { kind: 'LOW_STOCK'; availableQuantity: number }
  | { kind: 'PRICE_CHANGED'; previousUnitPricePaise: number };

export interface CartLineView {
  variantId: string;
  productSlug: string;
  productName: string;
  brandName: string;
  sku: string;
  optionValues: Record<string, string>;
  imageUrl: string | null;
  imageAlt: string | null;
  quantity: number;
  unitPricePaise: number;
  mrpPaise: number;
  lineTotalPaise: number;
  availableQuantity: number;
  maximumQuantity: number;
  isPurchasable: boolean;
  warnings: CartLineWarning[];
}

export interface CartCouponView {
  code: string;
  description: string;
  isApplied: boolean;
  discountPaise: number;
  message: string | null;
}

export interface CartView {
  lines: CartLineView[];
  itemCount: number;
  coupon: CartCouponView | null;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  shippingFeePaise: number;
  totalPaise: number;
  codFeePaise: number;
  freeShippingRemainingPaise: number;
  canCheckout: boolean;
}

export interface LineContext {
  variants: Map<string, PurchasableVariant>;
  availability: Map<string, number>;
}

async function loadLineContext(
  database: DatabaseClient,
  variantIds: readonly string[],
): Promise<LineContext> {
  const [variants, availability] = await Promise.all([
    findPurchasableVariants(variantIds, database),
    findAvailabilityForVariants(database, variantIds),
  ]);
  return { variants, availability };
}

function lineWarnings(
  variant: PurchasableVariant,
  line: StoredCartLine,
  availableQuantity: number,
): CartLineWarning[] {
  if (!variant.isSellable) return [{ kind: 'UNAVAILABLE' }];
  const warnings: CartLineWarning[] = [];
  if (availableQuantity <= 0) warnings.push({ kind: 'OUT_OF_STOCK' });
  else if (availableQuantity < line.quantity) {
    warnings.push({ kind: 'QUANTITY_EXCEEDS_STOCK', availableQuantity });
  } else if (availableQuantity <= lowStockWarningThreshold) {
    warnings.push({ kind: 'LOW_STOCK', availableQuantity });
  }
  if (line.addedUnitPricePaise !== null && line.addedUnitPricePaise !== variant.unitPricePaise) {
    warnings.push({ kind: 'PRICE_CHANGED', previousUnitPricePaise: line.addedUnitPricePaise });
  }
  return warnings;
}

function toLineView(
  line: StoredCartLine,
  variant: PurchasableVariant,
  availableQuantity: number,
): CartLineView {
  return {
    variantId: variant.variantId,
    productSlug: variant.productSlug,
    productName: variant.productName,
    brandName: variant.brandName,
    sku: variant.sku,
    optionValues: variant.optionValues,
    imageUrl: variant.imageUrl,
    imageAlt: variant.imageAlt,
    quantity: line.quantity,
    unitPricePaise: variant.unitPricePaise,
    mrpPaise: variant.mrpPaise,
    lineTotalPaise: variant.unitPricePaise * line.quantity,
    availableQuantity,
    maximumQuantity: Math.max(1, Math.min(maximumQuantityPerLine, availableQuantity)),
    isPurchasable: variant.isSellable && availableQuantity >= line.quantity,
    warnings: lineWarnings(variant, line, availableQuantity),
  };
}

function couponView(coupon: CouponRow, evaluation: CouponEvaluation): CartCouponView {
  return {
    code: coupon.code,
    description: coupon.description,
    isApplied: evaluation.isApplicable,
    discountPaise: evaluation.isApplicable ? evaluation.discountPaise : 0,
    message: evaluation.isApplicable ? null : evaluation.message,
  };
}

// C24 / C26: the cart as the customer sees it, priced from the database. The COD fee is shown separately
// because it depends on the payment method chosen at checkout.
function buildCartView(input: {
  lines: readonly StoredCartLine[];
  context: LineContext;
  settings: StoreSettings;
  coupon: { row: CouponRow; evaluation: CouponEvaluation } | null;
}): CartView {
  const lines = input.lines.flatMap((line) => {
    const variant = input.context.variants.get(line.variantId);
    if (variant === undefined) return [];
    return [toLineView(line, variant, input.context.availability.get(line.variantId) ?? 0)];
  });
  const evaluation = input.coupon?.evaluation;
  const breakdown = priceOrder({
    lines: lines.map((line) => ({
      lineKey: line.variantId,
      unitPricePaise: line.unitPricePaise,
      quantity: line.quantity,
      taxRateBasisPoints: input.context.variants.get(line.variantId)?.taxRateBasisPoints ?? 0,
    })),
    discountPaise: evaluation?.isApplicable === true ? evaluation.discountPaise : 0,
    fees: {
      shippingFeePaise: input.settings.shippingFeePaise,
      freeShippingThresholdPaise: input.settings.freeShippingThresholdPaise,
      codFeePaise: input.settings.codFeePaise,
    },
    paymentMethod: 'ONLINE',
  });
  const afterDiscountPaise = breakdown.subtotalPaise - breakdown.discountPaise;
  return {
    lines,
    itemCount: lines.reduce((total, line) => total + line.quantity, 0),
    coupon:
      input.coupon === null || evaluation === undefined
        ? null
        : couponView(input.coupon.row, evaluation),
    subtotalPaise: breakdown.subtotalPaise,
    discountPaise: breakdown.discountPaise,
    taxPaise: breakdown.taxPaise,
    shippingFeePaise: breakdown.shippingFeePaise,
    totalPaise: breakdown.totalPaise,
    codFeePaise: input.settings.codFeePaise,
    freeShippingRemainingPaise:
      lines.length === 0
        ? 0
        : Math.max(0, input.settings.freeShippingThresholdPaise - afterDiscountPaise),
    canCheckout: lines.length > 0 && lines.every((line) => line.isPurchasable),
  };
}

export async function evaluateCouponForCustomer(
  database: DatabaseClient,
  coupon: CouponRow,
  customerId: string,
  subtotalPaise: number,
): Promise<CouponEvaluation> {
  const [redemptionCount, placedOrderCount] = await Promise.all([
    countCouponRedemptionsForCustomer(database, coupon.id, customerId),
    countPlacedOrdersForCustomer(database, customerId),
  ]);
  return evaluateCoupon({
    terms: coupon,
    subtotalPaise,
    history: { redemptionCount, placedOrderCount },
    now: new Date(),
  });
}

function subtotalOf(lines: readonly StoredCartLine[], context: LineContext): number {
  return lines.reduce(
    (total, line) =>
      total + (context.variants.get(line.variantId)?.unitPricePaise ?? 0) * line.quantity,
    0,
  );
}

export async function getCustomerCartView(customer: CustomerContext): Promise<CartView> {
  const database = getDatabase();
  const [cart, settings] = await Promise.all([
    findCustomerCart(database, customer.customerId),
    loadStoreSettings(database),
  ]);
  const lines = cart?.items ?? [];
  const context = await loadLineContext(
    database,
    lines.map(({ variantId }) => variantId),
  );
  const couponRow =
    cart?.appliedCouponId === null || cart === null
      ? null
      : await findCouponById(database, cart.appliedCouponId);
  const coupon =
    couponRow === null
      ? null
      : {
          row: couponRow,
          evaluation: await evaluateCouponForCustomer(
            database,
            couponRow,
            customer.customerId,
            subtotalOf(lines, context),
          ),
        };
  return buildCartView({ lines, context, settings, coupon });
}

export async function getGuestCartView(guestLines: readonly GuestCartLine[]): Promise<CartView> {
  const database = getDatabase();
  const lines = guestLines.map((line) => ({ ...line, addedUnitPricePaise: null }));
  const [context, settings] = await Promise.all([
    loadLineContext(
      database,
      lines.map(({ variantId }) => variantId),
    ),
    loadStoreSettings(database),
  ]);
  return buildCartView({ lines, context, settings, coupon: null });
}

// C23: a line may hold at most the per-line maximum and never more than is available right now.
async function sellableVariantFor(
  database: DatabaseClient,
  variantId: string,
): Promise<{ variant: PurchasableVariant; availableQuantity: number }> {
  const context = await loadLineContext(database, [variantId]);
  const variant = context.variants.get(variantId);
  if (variant === undefined) throw cartErrors.variantNotFound();
  if (!variant.isSellable) throw cartErrors.variantUnavailable();
  return { variant, availableQuantity: context.availability.get(variantId) ?? 0 };
}

function assertQuantityAllowed(quantity: number, availableQuantity: number): void {
  if (quantity > maximumQuantityPerLine) {
    throw new DomainError({
      kind: 'UNPROCESSABLE',
      code: 'QUANTITY_LIMIT_EXCEEDED',
      message: `You can buy at most ${String(maximumQuantityPerLine)} of one item.`,
      details: { maximumQuantity: maximumQuantityPerLine },
    });
  }
  if (quantity > availableQuantity) {
    throw cartErrors.insufficientStock(availableQuantity, maximumQuantityPerLine);
  }
}

export async function addToCustomerCart(
  customer: CustomerContext,
  input: AddCartItemInput,
): Promise<void> {
  await getDatabase().$transaction(async (transaction) => {
    const cartId = await ensureCustomerCart(transaction, customer.customerId);
    await lockCustomerCart(transaction, cartId);
    const { variant, availableQuantity } = await sellableVariantFor(transaction, input.variantId);
    const currentQuantity = await findCartLineQuantity(transaction, cartId, input.variantId);
    if (currentQuantity === 0 && (await countCartLines(transaction, cartId)) >= maximumCartLines) {
      throw cartErrors.cartFull(maximumCartLines);
    }
    const quantity = currentQuantity + input.quantity;
    assertQuantityAllowed(quantity, availableQuantity);
    await setCartLine(transaction, {
      cartId,
      variantId: input.variantId,
      quantity,
      unitPricePaise: variant.unitPricePaise,
    });
  });
}

export async function updateCustomerCartLine(
  customer: CustomerContext,
  variantId: string,
  quantity: number,
): Promise<void> {
  await getDatabase().$transaction(async (transaction) => {
    const cartId = await ensureCustomerCart(transaction, customer.customerId);
    await lockCustomerCart(transaction, cartId);
    if ((await findCartLineQuantity(transaction, cartId, variantId)) === 0) {
      throw cartErrors.lineNotFound();
    }
    const { variant, availableQuantity } = await sellableVariantFor(transaction, variantId);
    assertQuantityAllowed(quantity, availableQuantity);
    await setCartLine(transaction, {
      cartId,
      variantId,
      quantity,
      unitPricePaise: variant.unitPricePaise,
    });
  });
}

export async function removeCustomerCartLine(
  customer: CustomerContext,
  variantId: string,
): Promise<void> {
  const database = getDatabase();
  const cart = await findCustomerCart(database, customer.customerId);
  if (cart === null || !(await deleteCartLine(database, cart.id, variantId))) {
    throw cartErrors.lineNotFound();
  }
}

export async function addToGuestCart(
  guestLines: readonly GuestCartLine[],
  input: AddCartItemInput,
): Promise<GuestCartLine[]> {
  const { availableQuantity } = await sellableVariantFor(getDatabase(), input.variantId);
  const existing = guestLines.find((line) => line.variantId === input.variantId);
  if (existing === undefined && guestLines.length >= maximumCartLines) {
    throw cartErrors.cartFull(maximumCartLines);
  }
  const quantity = (existing?.quantity ?? 0) + input.quantity;
  assertQuantityAllowed(quantity, availableQuantity);
  return existing === undefined
    ? [...guestLines, { variantId: input.variantId, quantity }]
    : guestLines.map((line) => (line.variantId === input.variantId ? { ...line, quantity } : line));
}

export async function updateGuestCartLine(
  guestLines: readonly GuestCartLine[],
  variantId: string,
  quantity: number,
): Promise<GuestCartLine[]> {
  if (!guestLines.some((line) => line.variantId === variantId)) throw cartErrors.lineNotFound();
  const { availableQuantity } = await sellableVariantFor(getDatabase(), variantId);
  assertQuantityAllowed(quantity, availableQuantity);
  return guestLines.map((line) => (line.variantId === variantId ? { ...line, quantity } : line));
}

export function removeGuestCartLine(
  guestLines: readonly GuestCartLine[],
  variantId: string,
): GuestCartLine[] {
  if (!guestLines.some((line) => line.variantId === variantId)) throw cartErrors.lineNotFound();
  return guestLines.filter((line) => line.variantId !== variantId);
}

// C22: on sign-in the guest cart is added to the saved cart. Quantities are summed and then limited to
// the per-line maximum and to current availability; unsellable or unknown variants are dropped. A line
// already in the saved cart never shrinks.
export async function mergeGuestCartIntoCustomerCart(
  customerId: string,
  guestLines: readonly GuestCartLine[],
): Promise<void> {
  if (guestLines.length === 0) return;
  await getDatabase().$transaction(async (transaction) => {
    const cartId = await ensureCustomerCart(transaction, customerId);
    await lockCustomerCart(transaction, cartId);
    const savedLines = (await findCustomerCart(transaction, customerId))?.items ?? [];
    const savedQuantity = new Map(savedLines.map((line) => [line.variantId, line.quantity]));
    const context = await loadLineContext(
      transaction,
      guestLines.map(({ variantId }) => variantId),
    );
    let lineCount = savedLines.length;
    for (const guestLine of guestLines) {
      const variant = context.variants.get(guestLine.variantId);
      if (variant === undefined || !variant.isSellable) continue;
      const existingQuantity = savedQuantity.get(guestLine.variantId) ?? 0;
      if (existingQuantity === 0 && lineCount >= maximumCartLines) continue;
      const limit = Math.min(
        maximumQuantityPerLine,
        context.availability.get(guestLine.variantId) ?? 0,
      );
      const quantity = Math.min(existingQuantity + guestLine.quantity, limit);
      if (quantity <= existingQuantity) continue;
      if (existingQuantity === 0) lineCount += 1;
      await setCartLine(transaction, {
        cartId,
        variantId: guestLine.variantId,
        quantity,
        unitPricePaise: variant.unitPricePaise,
      });
    }
  });
}

// C25: the coupon is checked now with the reason shown when it is refused, and again at checkout.
export async function applyCouponToCustomerCart(
  customer: CustomerContext,
  code: string,
): Promise<void> {
  const database = getDatabase();
  const coupon = await findCouponByCode(database, code);
  if (coupon === null) throw cartErrors.couponNotFound();
  const cart = await findCustomerCart(database, customer.customerId);
  const lines = cart?.items ?? [];
  if (cart === null || lines.length === 0) {
    throw cartErrors.couponRejected('CART_EMPTY', 'Add items to your cart before using a coupon.');
  }
  const context = await loadLineContext(
    database,
    lines.map(({ variantId }) => variantId),
  );
  const evaluation = await evaluateCouponForCustomer(
    database,
    coupon,
    customer.customerId,
    subtotalOf(lines, context),
  );
  if (!evaluation.isApplicable) {
    throw cartErrors.couponRejected(evaluation.rejectionCode, evaluation.message);
  }
  await setAppliedCoupon(database, cart.id, coupon.id);
}

export async function removeCouponFromCustomerCart(customer: CustomerContext): Promise<void> {
  const database = getDatabase();
  const cart = await findCustomerCart(database, customer.customerId);
  if (cart !== null && cart.appliedCouponId !== null) {
    await setAppliedCoupon(database, cart.id, null);
  }
}

// Checkout: the customer's cart, locked for the rest of the caller's transaction (one checkout per cart).
export async function lockCartForCheckout(
  transaction: DatabaseClient,
  customerId: string,
): Promise<{ cartId: string; lines: StoredCartLine[]; appliedCouponId: string | null }> {
  const cartId = await ensureCustomerCart(transaction, customerId);
  await lockCustomerCart(transaction, cartId);
  const cart = await findCustomerCart(transaction, customerId);
  return { cartId, lines: cart?.items ?? [], appliedCouponId: cart?.appliedCouponId ?? null };
}

// The checkout summary: the same lines without locking or creating anything.
export async function readCartForCheckout(
  database: DatabaseClient,
  customerId: string,
): Promise<{ lines: StoredCartLine[]; appliedCouponId: string | null }> {
  const cart = await findCustomerCart(database, customerId);
  return { lines: cart?.items ?? [], appliedCouponId: cart?.appliedCouponId ?? null };
}

export async function emptyCartAfterOrder(
  transaction: DatabaseClient,
  cartId: string,
): Promise<void> {
  await deleteAllCartLines(transaction, cartId);
  await setAppliedCoupon(transaction, cartId, null);
}

export async function loadCheckoutLineContext(
  database: DatabaseClient,
  variantIds: readonly string[],
): Promise<LineContext> {
  return loadLineContext(database, variantIds);
}
