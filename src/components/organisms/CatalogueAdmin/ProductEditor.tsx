'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { Heading } from '@/components/atoms/Heading';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Text } from '@/components/atoms/Text';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { updateProductSchema } from '@/modules/catalogue/catalogue.schema';
import {
  type AttributeFieldDefinition,
  AttributeFields,
  type AttributeValues,
} from './AttributeFields';
import {
  ActionFailure,
  ReadOnlyNotice,
  StatusBadge,
  useCatalogueAction,
} from './catalogue-actions';
import type { BrandChoice } from './ProductCreateForm';

export type EditableProduct = Readonly<{
  id: string;
  name: string;
  slug: string;
  description: string;
  brandId: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  attributes: unknown;
  taxRateBasisPoints: number;
  version: number;
  productType: Readonly<{ id: string; name: string }>;
}>;

const attributesSchema = z.record(z.string(), z.unknown());

function StatusActions({
  product,
  canWrite,
}: Readonly<{ product: EditableProduct; canWrite: boolean }>) {
  const router = useRouter();
  const { run, pendingKey, failure } = useCatalogueAction();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const changeStatus = (status: EditableProduct['status'], message: string) =>
    run(
      status,
      {
        url: `/api/admin/products/${product.id}/status`,
        method: 'POST',
        body: { expectedVersion: product.version, status },
      },
      message,
    );

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex flex-wrap items-center gap-sm">
        <StatusBadge status={product.status} />
        <Text variant="body3" tone="muted">
          Version {product.version}
        </Text>
      </div>
      <ActionFailure failure={failure} />
      {failure?.code === 'STALE_PRODUCT' ? (
        <div>
          <Button
            size="sm"
            iconBefore="restore"
            onClick={() => {
              router.refresh();
            }}
          >
            Reload the latest version
          </Button>
        </div>
      ) : null}
      {canWrite ? (
        <div className="flex flex-wrap gap-sm">
          {product.status === 'DRAFT' ? (
            <Button
              appearance="primary"
              isLoading={pendingKey === 'ACTIVE'}
              onClick={() => void changeStatus('ACTIVE', 'Product activated')}
            >
              Activate product
            </Button>
          ) : null}
          {product.status === 'ACTIVE' ? (
            <Button
              isLoading={pendingKey === 'DRAFT'}
              onClick={() => void changeStatus('DRAFT', 'Product moved to draft')}
            >
              Move to draft
            </Button>
          ) : null}
          {product.status === 'ARCHIVED' ? (
            <Button
              iconBefore="restore"
              isLoading={pendingKey === 'DRAFT'}
              onClick={() => void changeStatus('DRAFT', 'Product restored as a draft')}
            >
              Restore as draft
            </Button>
          ) : (
            <Button
              appearance="subtle"
              iconBefore="archive"
              onClick={() => {
                setConfirmArchive(true);
              }}
            >
              Archive product
            </Button>
          )}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive ${product.name}?`}
        description="It disappears from the product list and the store. Stock, open orders and history are kept, and you can restore it later."
        confirmLabel="Archive product"
        isPending={pendingKey === 'ARCHIVED'}
        onConfirm={() => {
          void changeStatus('ARCHIVED', 'Product archived').then(() => {
            setConfirmArchive(false);
          });
        }}
      />
    </div>
  );
}

function DetailsForm({
  product,
  productAttributes,
  brands,
  canEdit,
}: Readonly<{
  product: EditableProduct;
  productAttributes: readonly AttributeFieldDefinition[];
  brands: readonly BrandChoice[];
  canEdit: boolean;
}>) {
  const { run, pendingKey, failure } = useCatalogueAction();
  const storedAttributes = attributesSchema.safeParse(product.attributes);
  const [attributes, setAttributes] = useState<AttributeValues>(
    storedAttributes.success ? storedAttributes.data : {},
  );
  const [brandId, setBrandId] = useState(product.brandId);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [nothingChanged, setNothingChanged] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const read = formReader(event.currentTarget);
    const entered = {
      name: read('name'),
      slug: read('slug') || product.slug,
      description: read('description'),
      taxRateBasisPoints: Number(read('taxRateBasisPoints')),
      brandId,
    };
    const changes = Object.fromEntries(
      Object.entries(entered).filter(
        ([field, value]) => value !== product[field as keyof typeof entered],
      ),
    );
    const attributesChanged =
      JSON.stringify(attributes) !==
      JSON.stringify(storedAttributes.success ? storedAttributes.data : {});
    if (Object.keys(changes).length === 0 && !attributesChanged) {
      setNothingChanged(true);
      return;
    }
    setNothingChanged(false);
    const parsed = updateProductSchema.safeParse({
      expectedVersion: product.version,
      ...changes,
      ...(attributesChanged ? { attributes } : {}),
    });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    await run(
      'save',
      { url: `/api/admin/products/${product.id}`, method: 'PATCH', body: parsed.data },
      'Product saved',
    );
  }

  const errors = { ...fieldErrors, ...(failure?.fieldErrors ?? {}) };
  return (
    <form
      noValidate
      className="flex flex-col gap-lg"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <ActionFailure failure={failure} />
      {nothingChanged ? <InlineAlert tone="info">Nothing has changed yet.</InlineAlert> : null}
      <div className="grid grid-cols-1 gap-md md:grid-cols-2">
        <FormField
          label="Name"
          name="name"
          defaultValue={product.name}
          error={errors['name']}
          disabled={!canEdit}
          autoComplete="off"
        />
        <FormField
          label="Slug"
          name="slug"
          defaultValue={product.slug}
          hint={
            product.status === 'DRAFT'
              ? 'Can change only while the product is a draft.'
              : 'Locked: the product is no longer a draft.'
          }
          error={errors['slug']}
          disabled={!canEdit || product.status !== 'DRAFT'}
          autoComplete="off"
        />
        <SelectField
          label="Brand"
          name="brandId"
          options={brands.map(({ id, name }) => ({ value: id, label: name }))}
          value={brandId}
          error={errors['brandId']}
          disabled={!canEdit}
          onValueChange={setBrandId}
        />
        <FormField
          label="Tax rate (basis points)"
          name="taxRateBasisPoints"
          type="number"
          defaultValue={String(product.taxRateBasisPoints)}
          error={errors['taxRateBasisPoints']}
          disabled={!canEdit}
        />
        <FormField
          label="Description"
          name="description"
          defaultValue={product.description}
          error={errors['description']}
          disabled={!canEdit}
          autoComplete="off"
        />
      </div>
      <fieldset className="flex flex-col gap-md">
        <legend className="text-heading5 text-headings">
          {product.productType.name} attributes
        </legend>
        <AttributeFields
          definitions={productAttributes}
          values={attributes}
          errors={errors}
          disabled={!canEdit}
          onChange={setAttributes}
        />
      </fieldset>
      {canEdit ? (
        <div>
          <Button type="submit" appearance="primary" isLoading={pendingKey === 'save'}>
            Save product
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export function ProductEditor({
  product,
  productAttributes,
  brands,
  canWrite,
}: Readonly<{
  product: EditableProduct;
  productAttributes: readonly AttributeFieldDefinition[];
  brands: readonly BrandChoice[];
  canWrite: boolean;
}>) {
  const canEdit = canWrite && product.status !== 'ARCHIVED';
  return (
    <div className="flex flex-col gap-lg">
      <ReadOnlyNotice canWrite={canWrite} />
      <Card as="section">
        <div className="flex flex-col gap-md">
          <Heading level={2} variant="heading4">
            Status
          </Heading>
          <StatusActions product={product} canWrite={canWrite} />
        </div>
      </Card>
      <Card as="section">
        <div className="flex flex-col gap-md">
          <Heading level={2} variant="heading4">
            Details
          </Heading>
          {product.status === 'ARCHIVED' ? (
            <Text variant="body3" tone="muted">
              Archived products are read-only. Restore it to make changes.
            </Text>
          ) : null}
          <DetailsForm
            product={product}
            productAttributes={productAttributes}
            brands={brands}
            canEdit={canEdit}
          />
        </div>
      </Card>
    </div>
  );
}
