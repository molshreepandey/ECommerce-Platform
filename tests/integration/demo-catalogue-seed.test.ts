import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';

import { productSeeds } from '../../prisma/seed/catalogue-data';
import { seedDemoCatalogue, seedDemoDeliveryCoverage } from '../../prisma/seed/demo-catalogue.seed';
import { checkPincodeServiceability } from '@/modules/fulfilment/courier-serviceability.service';

import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function rowCounts() {
  const [products, variants, media, levels, movements, collections, warehouses] = await Promise.all(
    [
      database.product.count(),
      database.productVariant.count(),
      database.productMedia.count(),
      database.inventoryLevel.count(),
      database.inventoryMovement.count(),
      database.collection.count(),
      database.warehouse.count(),
    ],
  );
  return { products, variants, media, levels, movements, collections, warehouses };
}

beforeEach(async () => {
  // A fresh deployment database: migrations only.
  await truncateAllTestTables();
});

describe('demo catalogue seed (staging opt-in)', () => {
  it('loads a shoppable catalogue and nothing else: no accounts, orders, carts or settings', async () => {
    const result = await seedDemoCatalogue(database);
    expect(result).toMatchObject({ outcome: 'seeded', productCount: productSeeds.length });

    const activeInStock = await database.product.count({
      where: {
        status: 'ACTIVE',
        media: { some: {} },
        variants: {
          some: { status: 'ACTIVE', inventoryLevels: { some: { onHandQuantity: { gt: 0 } } } },
        },
      },
    });
    expect(activeInStock).toBeGreaterThan(20);
    expect(await database.category.count({ where: { parentId: null } })).toBe(4);

    const untouched = await Promise.all([
      database.staffUser.count(),
      database.customer.count(),
      database.role.count(),
      database.order.count(),
      database.cart.count(),
      database.coupon.count(),
      database.storeSetting.count(),
      database.review.count(),
    ]);
    expect(untouched).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('is idempotent: a second run writes nothing', async () => {
    await seedDemoCatalogue(database);
    const before = await rowCounts();
    const second = await seedDemoCatalogue(database);
    expect(second).toEqual({ outcome: 'already-present', productCount: productSeeds.length });
    expect(await rowCounts()).toEqual(before);
  });

  it('refuses a partly loaded catalogue and writes nothing', async () => {
    await seedDemoCatalogue(database);
    const firstSlug = productSeeds[0]?.slug ?? '';
    await database.product.update({
      where: { slug: firstSlug },
      data: { slug: `${firstSlug}-renamed` },
    });
    const before = await rowCounts();
    await expect(seedDemoCatalogue(database)).rejects.toThrow(
      /already exist.*Nothing was written/s,
    );
    expect(await rowCounts()).toEqual(before);
  });
});

describe('demo delivery coverage (checkout needs a courier for the pincode)', () => {
  it('adds the demo couriers once; the pincode check then answers from that data', async () => {
    expect((await checkPincodeServiceability(database, '560001')).isServiceable).toBe(false);
    const first = await seedDemoDeliveryCoverage(database);
    expect(first).toMatchObject({ outcome: 'seeded' });
    const served = await checkPincodeServiceability(database, '560001');
    expect(served.isServiceable).toBe(true);
    expect(served.estimatedDeliveryDays).toBeGreaterThan(0);
    const phagwara = await checkPincodeServiceability(database, '144011');
    expect(phagwara).toMatchObject({
      isServiceable: true,
      estimatedDeliveryDays: 6,
      isCashOnDeliveryAvailable: true,
    });
    const unserved = await checkPincodeServiceability(database, '999999');
    expect(unserved).toMatchObject({ isServiceable: false, estimatedDeliveryDays: null });

    const pincodes = await database.courierServiceablePincode.count();
    expect(await seedDemoDeliveryCoverage(database)).toMatchObject({ outcome: 'already-present' });
    expect(await database.courierServiceablePincode.count()).toBe(pincodes);
  });

  it('never touches couriers an admin already configured', async () => {
    await database.courierPartner.create({
      data: { code: 'own-courier', name: 'Own Courier', adapterKey: 'demo_courier', priority: 1 },
    });
    expect(await seedDemoDeliveryCoverage(database)).toEqual({
      outcome: 'already-present',
      courierCount: 1,
    });
    expect(await database.courierServiceablePincode.count()).toBe(0);
  });
});
