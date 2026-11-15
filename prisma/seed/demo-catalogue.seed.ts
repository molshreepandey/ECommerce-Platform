import type { PrismaClient } from '../../src/generated/prisma/client';
import { productSeeds } from './catalogue-data';
import { seedCatalogue } from './catalogue.seed';
import { seedCourierPartners } from './fulfilment.seed';
import { seedInventory } from './inventory.seed';
import { seedMerchandising } from './merchandising.seed';
import { seedWarehouses } from './warehouses.seed';

export type DemoCatalogueSeedResult =
  | { outcome: 'seeded'; productCount: number; variantCount: number; productIds: string[] }
  | { outcome: 'already-present'; productCount: number };

// Loads the demo catalogue into a deployment database: product types, brands, categories, products with
// variants, prices and images, collections, banners, warehouses and opening stock. No accounts, customers,
// carts, orders, coupons or settings. Idempotent and additive:
// - every seeded product already present: nothing is written;
// - none present: everything is written in one transaction, so a failure leaves no half catalogue;
// - only some present: refused, nothing is written (it never overwrites or deletes catalogue data).
export async function seedDemoCatalogue(client: PrismaClient): Promise<DemoCatalogueSeedResult> {
  const seededSlugs = productSeeds.map((productSeed) => productSeed.slug);
  const presentCount = await client.product.count({ where: { slug: { in: seededSlugs } } });
  if (presentCount === seededSlugs.length) {
    return { outcome: 'already-present', productCount: presentCount };
  }
  if (presentCount > 0) {
    throw new Error(
      `Refusing: ${String(presentCount)} of the ${String(seededSlugs.length)} demo products already exist, ` +
        'so the catalogue was edited or partly loaded. Nothing was written.',
    );
  }

  return client.$transaction(
    async (transaction) => {
      const catalogue = await seedCatalogue(transaction);
      await seedMerchandising(transaction, catalogue.productIdBySlug);
      const warehouseIdByCode = await seedWarehouses(transaction, { updateExisting: false });
      await seedInventory(transaction, {
        variants: catalogue.variants,
        warehouseIdByCode,
        orderEvents: [],
      });
      return {
        outcome: 'seeded' as const,
        productCount: catalogue.productIdBySlug.size,
        variantCount: catalogue.variants.length,
        productIds: [...catalogue.productIdBySlug.values()],
      };
    },
    // A remote database (Railway) needs a few hundred round trips; the default 5 s would abort it.
    { maxWait: 30_000, timeout: 15 * 60_000 },
  );
}

export type DemoDeliveryCoverageResult =
  | { outcome: 'seeded'; courierCount: number; pincodeCount: number }
  | { outcome: 'already-present'; courierCount: number };

// Checkout needs a courier that serves the delivery pincode. This adds the demo couriers (simulated
// "demo_courier" adapter) and the pincodes they serve, only when the database has no courier at all, so
// couriers an admin configured are never changed. One transaction; a second run writes nothing.
export async function seedDemoDeliveryCoverage(
  client: PrismaClient,
): Promise<DemoDeliveryCoverageResult> {
  const existing = await client.courierPartner.count();
  if (existing > 0) return { outcome: 'already-present', courierCount: existing };
  return client.$transaction(
    async (transaction) => {
      const couriers = await seedCourierPartners(transaction);
      return {
        outcome: 'seeded' as const,
        courierCount: couriers.length,
        pincodeCount: await transaction.courierServiceablePincode.count(),
      };
    },
    { maxWait: 30_000, timeout: 5 * 60_000 },
  );
}
