'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import type { BrandChoice } from './ProductCreateForm';

const anyValue = '__any__';

export type ProductFilterValues = Readonly<{
  search?: string | undefined;
  productTypeId?: string | undefined;
  brandId?: string | undefined;
  status?: string | undefined;
  stock?: string | undefined;
  sort?: string | undefined;
}>;

// Filters live in the URL, so a filtered list can be bookmarked and the server page reads them.
export function ProductFilters({
  values,
  productTypes,
  brands,
}: Readonly<{
  values: ProductFilterValues;
  productTypes: readonly { id: string; name: string }[];
  brands: readonly BrandChoice[];
}>) {
  const router = useRouter();
  const [productTypeId, setProductTypeId] = useState(values.productTypeId ?? anyValue);
  const [brandId, setBrandId] = useState(values.brandId ?? anyValue);
  const [status, setStatus] = useState(values.status ?? anyValue);
  const [stock, setStock] = useState(values.stock ?? anyValue);
  const [sort, setSort] = useState(values.sort ?? 'NEWEST');

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = new FormData(event.currentTarget).get('search');
    const query = new URLSearchParams();
    if (typeof search === 'string' && search.trim() !== '') query.set('search', search.trim());
    for (const [name, value] of Object.entries({ productTypeId, brandId, status, stock })) {
      if (value !== anyValue) query.set(name, value);
    }
    if (sort !== 'NEWEST') query.set('sort', sort);
    router.push(query.size === 0 ? '/products' : `/products?${query.toString()}`);
  }

  return (
    <form
      role="search"
      aria-label="Filter products"
      noValidate
      className="grid grid-cols-1 gap-md rounded-default border border-lowlight bg-white p-md md:grid-cols-3"
      onSubmit={handleSubmit}
    >
      <FormField
        label="Search by name"
        name="search"
        type="search"
        defaultValue={values.search ?? ''}
      />
      <SelectField
        label="Product type"
        name="productTypeId"
        options={[
          { value: anyValue, label: 'Any type' },
          ...productTypes.map(({ id, name }) => ({ value: id, label: name })),
        ]}
        value={productTypeId}
        onValueChange={setProductTypeId}
      />
      <SelectField
        label="Brand"
        name="brandId"
        options={[
          { value: anyValue, label: 'Any brand' },
          ...brands.map(({ id, name }) => ({ value: id, label: name })),
        ]}
        value={brandId}
        onValueChange={setBrandId}
      />
      <SelectField
        label="Status"
        name="status"
        options={[
          { value: anyValue, label: 'Draft or active' },
          { value: 'DRAFT', label: 'Draft' },
          { value: 'ACTIVE', label: 'Active' },
          { value: 'ARCHIVED', label: 'Archived' },
        ]}
        value={status}
        onValueChange={setStatus}
      />
      <SelectField
        label="Stock"
        name="stock"
        options={[
          { value: anyValue, label: 'Any stock' },
          { value: 'IN_STOCK', label: 'In stock' },
          { value: 'OUT_OF_STOCK', label: 'Out of stock' },
        ]}
        value={stock}
        onValueChange={setStock}
      />
      <SelectField
        label="Sort by"
        name="sort"
        options={[
          { value: 'NEWEST', label: 'Newest first' },
          { value: 'OLDEST', label: 'Oldest first' },
          { value: 'NAME', label: 'Name A–Z' },
        ]}
        value={sort}
        onValueChange={setSort}
      />
      <div className="flex gap-sm md:col-span-3">
        <Button type="submit" appearance="primary" iconBefore="search">
          Apply filters
        </Button>
        <Button
          onClick={() => {
            router.push('/products');
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}
