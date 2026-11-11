import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Flexbox } from '@/components/atoms/Flexbox';
import { InventoryReadOnlyNotice, WarehouseManager } from '@/components/organisms/InventoryAdmin';
import { listWarehouses } from '@/modules/inventory/warehouse.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';

export const metadata: Metadata = { title: 'Warehouses' };

export default function WarehousesPage() {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/warehouses"
        title="Warehouses"
        readPermission="inventory.read"
        writePermission="warehouses.write"
      >
        {async ({ staff, canWrite }) => (
          <Flexbox direction="column" gap="lg" align="stretch">
            <InventoryReadOnlyNotice canWrite={canWrite} what="warehouses" />
            <WarehouseManager warehouses={await listWarehouses(staff)} canWrite={canWrite} />
          </Flexbox>
        )}
      </AdminPageFrame>
    </Suspense>
  );
}
