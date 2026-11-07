import type { SeededVariant } from './catalogue.seed';
import type { SeededCustomer } from './identity.seed';
import type { SeedClient } from './seed-client';
import { requireValue } from './seed-ids';

const priceDropSinceAddedPaise = 10000;

const cartLineSeeds = [
  { sku: 'BEA040-200ML', quantity: 1, addedBeforePriceDrop: false },
  { sku: 'APP008-L-WHITE', quantity: 1, addedBeforePriceDrop: true },
] as const;

export async function seedCart(
  client: SeedClient,
  customer: SeededCustomer,
  variantBySku: Map<string, SeededVariant>,
): Promise<void> {
  const cart = await client.cart.upsert({
    where: { customerId: customer.id },
    create: { customerId: customer.id },
    update: {},
    select: { id: true },
  });
  for (const cartLineSeed of cartLineSeeds) {
    const variant = requireValue(variantBySku.get(cartLineSeed.sku), `variant ${cartLineSeed.sku}`);
    const addedUnitPricePaise = cartLineSeed.addedBeforePriceDrop
      ? variant.pricePaise + priceDropSinceAddedPaise
      : variant.pricePaise;
    await client.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
      create: {
        cartId: cart.id,
        variantId: variant.id,
        quantity: cartLineSeed.quantity,
        addedUnitPricePaise,
      },
      update: { quantity: cartLineSeed.quantity, addedUnitPricePaise },
    });
  }
}
