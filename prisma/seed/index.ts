import { seedCart } from './cart.seed';
import { assertDemoCredentialsAllowed } from './demo-credentials';
import { applyDemoPasswordHashes } from './demo-passwords.seed';
import { seedCatalogue } from './catalogue.seed';
import { seedCourierPartners } from './fulfilment.seed';
import { seedIdentity } from './identity.seed';
import { seedInventory } from './inventory.seed';
import { seedMerchandising } from './merchandising.seed';
import { seedOrders } from './orders.seed';
import { seedCoupons } from './pricing.seed';
import { createSeedClient } from './seed-client';
import { requireValue } from './seed-ids';
import { seedStoreSettings } from './settings.seed';
import { seedWarehouses } from './warehouses.seed';

async function seedDatabase(): Promise<void> {
  assertDemoCredentialsAllowed(process.env['APP_ENV']);
  const client = createSeedClient();
  try {
    const customerByKey = await seedIdentity(client);
    await applyDemoPasswordHashes(client);
    await seedStoreSettings(client);
    const catalogue = await seedCatalogue(client);
    await seedMerchandising(client, catalogue.productIdBySlug);
    const warehouseIdByCode = await seedWarehouses(client);
    const courierPartners = await seedCourierPartners(client);
    const couponIdByCode = await seedCoupons(client);
    const variantBySku = new Map(catalogue.variants.map((variant) => [variant.sku, variant]));

    const orderEvents = await seedOrders(client, {
      customerByKey,
      variantBySku,
      warehouseIdByCode,
      courierPartners,
      couponIdByCode,
    });
    await seedInventory(client, { variants: catalogue.variants, warehouseIdByCode, orderEvents });
    await seedCart(client, requireValue(customerByKey.get('asha'), 'customer asha'), variantBySku);

    console.info(
      `Seeded ${String(catalogue.variants.length)} variants, ${String(catalogue.productIdBySlug.size)} products and ${String(orderEvents.length)} order stock events.`,
    );
  } finally {
    await client.$disconnect();
  }
}

await seedDatabase();
