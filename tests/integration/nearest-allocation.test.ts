import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { loadStoreSettings, updateStoreSettings } from '@/modules/pricing/store-settings.service';

import {
  checkoutWith,
  createCourier,
  createShopper,
  orderWithRelations,
  stockTotals,
} from './support/commerce-fixtures';
import { testMetadata } from './support/identity-fixtures';
import {
  createStaffMember,
  createStockLevelRow,
  createVariantRow,
  createWarehouseRow,
} from './support/inventory-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

// A variant stocked in a far, high-priority warehouse (Bengaluru) and a near, lower-priority one (Pune);
// shoppers live at 411001 (Pune).
async function twoWarehouses() {
  const variant = await createVariantRow();
  const far = await createWarehouseRow({ priority: 1, pincode: '560034' });
  const near = await createWarehouseRow({ priority: 5, pincode: '411045' });
  for (const warehouse of [far, near]) {
    await createStockLevelRow({
      variantId: variant.variantId,
      warehouseId: warehouse.id,
      onHandQuantity: 5,
    });
  }
  return { variant, farId: far.id, nearId: near.id };
}

async function setStrategy(allocationStrategy: 'PRIORITY' | 'NEAREST_PINCODE') {
  const staff = await createStaffMember(['settings.write']);
  await updateStoreSettings(
    staff,
    { ...(await loadStoreSettings()), allocationStrategy },
    testMetadata(),
  );
}

async function shippingWarehouses(variantId: string) {
  const { customer, addressId } = await createShopper();
  const placed = await checkoutWith({ customer, addressId, lines: [{ variantId, quantity: 2 }] });
  return (await orderWithRelations(placed.orderId)).shipments.map(({ warehouseId }) => warehouseId);
}

beforeEach(async () => {
  await truncateAllTestTables();
  await createCourier();
});

describe('pincode-distance allocation at checkout (Wave 16)', () => {
  it('by default ships from the highest-priority warehouse, as before', async () => {
    const setup = await twoWarehouses();
    expect(await shippingWarehouses(setup.variant.variantId)).toEqual([setup.farId]);
  });

  it('with NEAREST_PINCODE ships from the warehouse nearest the delivery pincode and reserves there', async () => {
    const setup = await twoWarehouses();
    await setStrategy('NEAREST_PINCODE');
    expect(await shippingWarehouses(setup.variant.variantId)).toEqual([setup.nearId]);
    const levels = (await stockTotals(setup.variant.variantId)).levels;
    expect(levels.find(({ warehouseId }) => warehouseId === setup.nearId)?.reservedQuantity).toBe(
      2,
    );
    expect(levels.find(({ warehouseId }) => warehouseId === setup.farId)?.reservedQuantity).toBe(0);
    expect(
      await database.auditLog.count({
        where: {
          action: 'settings.updated',
          after: { path: ['allocationStrategy'], equals: 'NEAREST_PINCODE' },
        },
      }),
    ).toBe(1);
  });

  it('with NEAREST_PINCODE falls back to a farther warehouse when the nearest cannot fulfil', async () => {
    const setup = await twoWarehouses();
    await setStrategy('NEAREST_PINCODE');
    await database.inventoryLevel.update({
      where: {
        variantId_warehouseId: { variantId: setup.variant.variantId, warehouseId: setup.nearId },
      },
      data: { onHandQuantity: 1 },
    });
    expect(await shippingWarehouses(setup.variant.variantId)).toEqual([setup.farId]);
  });
});
