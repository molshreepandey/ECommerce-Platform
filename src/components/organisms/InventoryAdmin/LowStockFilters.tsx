'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { SelectField } from '@/components/molecules/SelectField';
import { type WarehouseChoice, warehouseLabel } from './inventory-types';

const anyWarehouse = '__any__';

export function LowStockFilters({
  values,
  warehouses,
}: Readonly<{
  values: Readonly<{ warehouseId?: string; includeInactiveWarehouses?: boolean }>;
  warehouses: readonly WarehouseChoice[];
}>) {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(values.warehouseId ?? anyWarehouse);
  const [includeInactive, setIncludeInactive] = useState(values.includeInactiveWarehouses ?? false);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();
    if (warehouseId !== anyWarehouse) query.set('warehouseId', warehouseId);
    if (includeInactive) query.set('includeInactiveWarehouses', 'true');
    router.push(
      query.size === 0 ? '/inventory/low-stock' : `/inventory/low-stock?${query.toString()}`,
    );
  }

  return (
    <form
      role="search"
      aria-label="Filter low stock"
      noValidate
      className="grid grid-cols-1 gap-md rounded-default border border-lowlight bg-white p-md md:grid-cols-2"
      onSubmit={handleSubmit}
    >
      <SelectField
        label="Warehouse"
        name="warehouseId"
        options={[
          { value: anyWarehouse, label: 'All warehouses' },
          ...warehouses.map((warehouse) => ({
            value: warehouse.id,
            label: warehouseLabel(warehouse),
          })),
        ]}
        value={warehouseId}
        onValueChange={setWarehouseId}
      />
      <div className="flex items-end pb-sm">
        <Checkbox
          label="Include inactive warehouses"
          checked={includeInactive}
          onCheckedChange={(checked) => {
            setIncludeInactive(checked === true);
          }}
        />
      </div>
      <div className="flex gap-sm md:col-span-2">
        <Button type="submit" appearance="primary" iconBefore="search">
          Apply filters
        </Button>
        <Button
          onClick={() => {
            router.push('/inventory/low-stock');
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}
