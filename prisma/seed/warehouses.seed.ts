import type { SeedClient } from './seed-client';

const warehouseSeeds = [
  {
    code: 'WH-BLR',
    name: 'Bengaluru Fulfilment Centre',
    addressLine1: 'Plot 21, Electronic City Phase 2',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560068',
    contactName: 'Ravi Kumar',
    contactPhone: '9876511001',
    priority: 1,
  },
  {
    code: 'WH-DEL',
    name: 'Delhi Fulfilment Centre',
    addressLine1: 'B-55, Okhla Industrial Area Phase 1',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110020',
    contactName: 'Imran Khan',
    contactPhone: '9876511002',
    priority: 2,
  },
  {
    code: 'WH-MUM',
    name: 'Bhiwandi Warehouse',
    addressLine1: 'Gala 7, Rahnal Logistics Park',
    city: 'Bhiwandi',
    state: 'Maharashtra',
    pincode: '421302',
    contactName: 'Sneha Patil',
    contactPhone: '9876511003',
    priority: 3,
  },
] as const;

export type WarehouseCode = (typeof warehouseSeeds)[number]['code'];

export async function seedWarehouses(client: SeedClient): Promise<Map<WarehouseCode, string>> {
  const warehouseIdByCode = new Map<WarehouseCode, string>();
  for (const warehouseSeed of warehouseSeeds) {
    const { code, ...warehouseFields } = warehouseSeed;
    const warehouse = await client.warehouse.upsert({
      where: { code },
      create: { code, ...warehouseFields, isActive: true },
      update: warehouseFields,
      select: { id: true },
    });
    warehouseIdByCode.set(code, warehouse.id);
  }
  return warehouseIdByCode;
}
