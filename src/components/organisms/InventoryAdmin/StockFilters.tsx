'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import { type WarehouseChoice, warehouseLabel } from './inventory-types';

const anyWarehouse = '__any__';

// Filters live in the URL so a filtered stock view can be bookmarked; the server page reads them.
export function StockFilters({
  values,
  warehouses,
}: Readonly<{
  values: Readonly<{ search?: string; warehouseId?: string; lowStockOnly?: boolean }>;
  warehouses: readonly WarehouseChoice[];
}>) {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(values.warehouseId ?? anyWarehouse);
  const [lowStockOnly, setLowStockOnly] = useState(values.lowStockOnly ?? false);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = new FormData(event.currentTarget).get('search');
    const query = new URLSearchParams();
    if (typeof search === 'string' && search.trim() !== '') query.set('search', search.trim());
    if (warehouseId !== anyWarehouse) query.set('warehouseId', warehouseId);
    if (lowStockOnly) query.set('lowStockOnly', 'true');
    router.push(query.size === 0 ? '/inventory' : `/inventory?${query.toString()}`);
  }

  return (
    <form
      role="search"
      aria-label="Filter stock"
      noValidate
      className="grid grid-cols-1 gap-md rounded-default border border-lowlight bg-white p-md md:grid-cols-3"
      onSubmit={handleSubmit}
    >
      <FormField
        label="Search product or SKU"
        name="search"
        type="search"
        defaultValue={values.search ?? ''}
      />
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
          label="Only low stock"
          checked={lowStockOnly}
          onCheckedChange={(checked) => {
            setLowStockOnly(checked === true);
          }}
        />
      </div>
      <div className="flex gap-sm md:col-span-3">
        <Button type="submit" appearance="primary" iconBefore="search">
          Apply filters
        </Button>
        <Button
          onClick={() => {
            router.push('/inventory');
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}
