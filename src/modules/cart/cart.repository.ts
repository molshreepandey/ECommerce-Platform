import type { DatabaseClient } from '@/lib/db';

export interface StoredCartLine {
  variantId: string;
  quantity: number;
  addedUnitPricePaise: number | null;
}

export async function findCustomerCart(database: DatabaseClient, customerId: string) {
  return database.cart.findUnique({
    where: { customerId },
    select: {
      id: true,
      appliedCouponId: true,
      items: {
        select: { variantId: true, quantity: true, addedUnitPricePaise: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });
}

export async function ensureCustomerCart(
  database: DatabaseClient,
  customerId: string,
): Promise<string> {
  const cart = await database.cart.upsert({
    where: { customerId },
    create: { customerId },
    update: {},
    select: { id: true },
  });
  return cart.id;
}

// Serialises concurrent changes to one customer's cart (add, merge, checkout) on the cart row.
export async function lockCustomerCart(database: DatabaseClient, cartId: string): Promise<void> {
  await database.$queryRaw`SELECT id FROM carts WHERE id = ${cartId}::uuid FOR UPDATE`;
}

export async function findCartLineQuantity(
  database: DatabaseClient,
  cartId: string,
  variantId: string,
): Promise<number> {
  const line = await database.cartItem.findUnique({
    where: { cartId_variantId: { cartId, variantId } },
    select: { quantity: true },
  });
  return line?.quantity ?? 0;
}

export async function countCartLines(database: DatabaseClient, cartId: string): Promise<number> {
  return database.cartItem.count({ where: { cartId } });
}

export async function setCartLine(
  database: DatabaseClient,
  line: { cartId: string; variantId: string; quantity: number; unitPricePaise: number },
): Promise<void> {
  await database.cartItem.upsert({
    where: { cartId_variantId: { cartId: line.cartId, variantId: line.variantId } },
    create: {
      cartId: line.cartId,
      variantId: line.variantId,
      quantity: line.quantity,
      addedUnitPricePaise: line.unitPricePaise,
    },
    update: { quantity: line.quantity, addedUnitPricePaise: line.unitPricePaise },
    select: { id: true },
  });
}

export async function deleteCartLine(
  database: DatabaseClient,
  cartId: string,
  variantId: string,
): Promise<boolean> {
  const { count } = await database.cartItem.deleteMany({ where: { cartId, variantId } });
  return count > 0;
}

export async function deleteAllCartLines(database: DatabaseClient, cartId: string): Promise<void> {
  await database.cartItem.deleteMany({ where: { cartId } });
}

export async function setAppliedCoupon(
  database: DatabaseClient,
  cartId: string,
  couponId: string | null,
): Promise<void> {
  await database.cart.update({
    where: { id: cartId },
    data: { appliedCouponId: couponId },
    select: { id: true },
  });
}

export async function sumCustomerCartQuantity(
  database: DatabaseClient,
  customerId: string,
): Promise<number> {
  const result = await database.cartItem.aggregate({
    where: { cart: { customerId } },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}
