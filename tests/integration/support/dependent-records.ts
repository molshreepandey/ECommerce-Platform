import { getDatabase } from '@/lib/db';

const database = getDatabase();

// Rows in other modules that point at a product (stock, movements, cart, order lines, review, collection).
// Catalogue, category and group changes must leave all of them byte-identical.
export async function dependentRecords(): Promise<Record<string, unknown>> {
  const tables = [
    'inventory_levels',
    'inventory_movements',
    'carts',
    'cart_items',
    'orders',
    'order_items',
    'reviews',
    'collection_products',
  ] as const;
  const snapshot: Record<string, unknown> = {};
  for (const table of tables) {
    snapshot[table] = await database.$queryRawUnsafe(
      `SELECT to_jsonb(t)::text AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
    );
  }
  return snapshot;
}

export async function createDependents(productId: string, variantId: string) {
  const customer = await database.customer.create({
    data: {
      fullName: 'Asha Test',
      email: 'asha.test@example.test',
      phone: '9876500111',
      passwordHash: 'not-a-real-hash',
    },
  });
  const warehouse = await database.warehouse.create({
    data: {
      code: 'WH-TEST',
      name: 'Test Warehouse',
      addressLine1: '1 Test Street',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      contactName: 'Test Contact',
      contactPhone: '9876500000',
      priority: 1,
    },
  });
  await database.inventoryLevel.create({
    data: { variantId, warehouseId: warehouse.id, onHandQuantity: 10, reservedQuantity: 3 },
  });
  await database.inventoryMovement.create({
    data: {
      variantId,
      warehouseId: warehouse.id,
      movementType: 'RESERVE',
      quantityDelta: 3,
      onHandAfter: 10,
      reservedAfter: 3,
      actorType: 'SYSTEM',
      reason: 'test reservation',
    },
  });
  const cart = await database.cart.create({ data: { customerId: customer.id } });
  await database.cartItem.create({
    data: { cartId: cart.id, variantId, quantity: 2, addedUnitPricePaise: 79_900 },
  });
  const order = await database.order.create({
    data: {
      orderNumber: 'ORD-TEST-0001',
      customerId: customer.id,
      idempotencyKey: 'archive-test',
      requestFingerprint: 'a'.repeat(64),
      subtotalPaise: 79_900,
      taxPaise: 3_805,
      totalPaise: 79_900,
      shippingAddress: { city: 'Bengaluru', pincode: '560001' },
    },
  });
  const orderItem = await database.orderItem.create({
    data: {
      orderId: order.id,
      variantId,
      productId,
      productName: 'Product kurta',
      brandName: 'Brand kurta',
      sku: 'KURTA-M',
      optionValues: { size: 'M' },
      imageUrl: 'https://picsum.photos/seed/kurta/600/800',
      quantity: 1,
      mrpPaise: 99_900,
      unitPricePaise: 79_900,
      taxRateBasisPoints: 500,
      taxPaise: 3_805,
      lineTotalPaise: 79_900,
      weightGrams: 500,
      lengthMm: 300,
      breadthMm: 200,
      heightMm: 50,
    },
  });
  await database.review.create({
    data: {
      productId,
      customerId: customer.id,
      orderItemId: orderItem.id,
      rating: 5,
      title: 'Lovely',
    },
  });
  const collection = await database.collection.create({
    data: { name: 'Festive', slug: 'festive' },
  });
  await database.collectionProduct.create({ data: { collectionId: collection.id, productId } });
}
