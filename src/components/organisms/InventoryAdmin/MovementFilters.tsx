'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import { movementTypeLabels } from './inventory-format';
import { type WarehouseChoice, warehouseLabel } from './inventory-types';

const anyValue = '__any__';

export type MovementFilterValues = Readonly<{
  warehouseId?: string;
  variantId?: string;
  movementType?: string;
  from?: string;
  to?: string;
}>;

// Filters live in the URL. Dates are calendar days in India Standard Time; the page turns them into the
// API's bounds. A variant filter comes from a "History" link and is kept until cleared.
export function MovementFilters({
  values,
  warehouses,
}: Readonly<{ values: MovementFilterValues; warehouses: readonly WarehouseChoice[] }>) {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(values.warehouseId ?? anyValue);
  const [movementType, setMovementType] = useState(values.movementType ?? anyValue);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = new URLSearchParams();
    if (values.variantId !== undefined) query.set('variantId', values.variantId);
    if (warehouseId !== anyValue) query.set('warehouseId', warehouseId);
    if (movementType !== anyValue) query.set('movementType', movementType);
    for (const name of ['from', 'to'] as const) {
      const value = form.get(name);
      if (typeof value === 'string' && value !== '') query.set(name, value);
    }
    router.push(
      query.size === 0 ? '/inventory/movements' : `/inventory/movements?${query.toString()}`,
    );
  }

  return (
    <form
      role="search"
      aria-label="Filter stock movements"
      noValidate
      className="grid grid-cols-1 gap-md rounded-default border border-lowlight bg-white p-md md:grid-cols-2 lg:grid-cols-4"
      onSubmit={handleSubmit}
    >
      <SelectField
        label="Warehouse"
        name="warehouseId"
        options={[
          { value: anyValue, label: 'All warehouses' },
          ...warehouses.map((warehouse) => ({
            value: warehouse.id,
            label: warehouseLabel(warehouse),
          })),
        ]}
        value={warehouseId}
        onValueChange={setWarehouseId}
      />
      <SelectField
        label="Movement type"
        name="movementType"
        options={[
          { value: anyValue, label: 'All types' },
          ...Object.entries(movementTypeLabels).map(([value, label]) => ({ value, label })),
        ]}
        value={movementType}
        onValueChange={setMovementType}
      />
      <FormField label="From (IST)" name="from" type="date" defaultValue={values.from ?? ''} />
      <FormField label="To (IST, inclusive)" name="to" type="date" defaultValue={values.to ?? ''} />
      <div className="flex gap-sm md:col-span-2 lg:col-span-4">
        <Button type="submit" appearance="primary" iconBefore="search">
          Apply filters
        </Button>
        <Button
          onClick={() => {
            router.push('/inventory/movements');
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}
