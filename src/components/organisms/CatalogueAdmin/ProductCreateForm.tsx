'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/atoms/EmptyState';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { createProductSchema } from '@/modules/catalogue/catalogue.schema';
import {
  type AttributeFieldDefinition,
  AttributeFields,
  type AttributeValues,
} from './AttributeFields';
import { ActionFailure, useCatalogueAction } from './catalogue-actions';

export type ProductTypeChoice = Readonly<{
  id: string;
  name: string;
  productAttributes: readonly AttributeFieldDefinition[];
}>;
export type BrandChoice = Readonly<{ id: string; name: string }>;

const createdProductSchema = z.object({ product: z.object({ id: z.uuid() }) });

export function ProductCreateForm({
  productTypes,
  brands,
}: Readonly<{ productTypes: readonly ProductTypeChoice[]; brands: readonly BrandChoice[] }>) {
  const router = useRouter();
  const { run, pendingKey, failure } = useCatalogueAction();
  const [productTypeId, setProductTypeId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [attributes, setAttributes] = useState<AttributeValues>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const productType = productTypes.find(({ id }) => id === productTypeId);

  if (productTypes.length === 0 || brands.length === 0) {
    return (
      <EmptyState
        icon="layers"
        headingLevel={2}
        title="Add a product type and a brand first"
        description="Every product needs an active product type and an active brand."
      />
    );
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const read = formReader(event.currentTarget);
    const parsed = createProductSchema.safeParse({
      productTypeId,
      brandId,
      name: read('name'),
      ...(read('slug').trim() === '' ? {} : { slug: read('slug') }),
      description: read('description'),
      attributes,
      taxRateBasisPoints: Number(read('taxRateBasisPoints')),
    });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    const created = createdProductSchema.safeParse(
      await run(
        'create',
        { url: '/api/admin/products', method: 'POST', body: parsed.data },
        'Product created',
      ),
    );
    if (created.success) router.push(`/products/${created.data.product.id}`);
  }

  const errors = { ...fieldErrors, ...(failure?.fieldErrors ?? {}) };
  return (
    <form
      noValidate
      className="flex max-w-3xl flex-col gap-lg"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <ActionFailure failure={failure} />
      <div className="grid grid-cols-1 gap-md md:grid-cols-2">
        <SelectField
          label="Product type"
          name="productTypeId"
          options={productTypes.map(({ id, name }) => ({ value: id, label: name }))}
          value={productTypeId}
          placeholder="Choose a product type"
          error={errors['productTypeId']}
          onValueChange={(value) => {
            setProductTypeId(value);
            setAttributes({});
          }}
        />
        <SelectField
          label="Brand"
          name="brandId"
          options={brands.map(({ id, name }) => ({ value: id, label: name }))}
          value={brandId}
          placeholder="Choose a brand"
          error={errors['brandId']}
          onValueChange={setBrandId}
        />
        <FormField label="Name" name="name" error={errors['name']} autoComplete="off" />
        <FormField
          label="Slug (optional)"
          name="slug"
          hint="Made from the name if left empty."
          error={errors['slug']}
          autoComplete="off"
        />
        <FormField
          label="Tax rate (basis points)"
          name="taxRateBasisPoints"
          type="number"
          defaultValue="500"
          hint="100 basis points = 1 %. 500 = 5 %."
          error={errors['taxRateBasisPoints']}
        />
        <FormField
          label="Description (optional)"
          name="description"
          error={errors['description']}
          autoComplete="off"
        />
      </div>
      {productType === undefined ? null : (
        <fieldset className="flex flex-col gap-md">
          <legend className="text-heading5 text-headings">{productType.name} attributes</legend>
          <AttributeFields
            definitions={productType.productAttributes}
            values={attributes}
            errors={errors}
            onChange={setAttributes}
          />
        </fieldset>
      )}
      <div>
        <Button type="submit" appearance="primary" isLoading={pendingKey === 'create'}>
          Create product
        </Button>
      </div>
    </form>
  );
}
