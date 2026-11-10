'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Link } from '@/components/atoms/Link';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { createProductTypeSchema } from '@/modules/catalogue/catalogue.schema';
import { ActionFailure, StatusBadge, useCatalogueAction } from './catalogue-actions';

export type ProductTypeListItem = Readonly<{
  id: string;
  code: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
}>;

const formId = 'product-type-form';

export function ProductTypeManager({
  productTypes,
  canWrite,
}: Readonly<{ productTypes: readonly ProductTypeListItem[]; canWrite: boolean }>) {
  const { run, pendingKey, failure } = useCatalogueAction();
  const [isOpen, setIsOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const read = formReader(event.currentTarget);
    const parsed = createProductTypeSchema.safeParse({
      code: read('code'),
      name: read('name'),
      ...(read('description').trim() === '' ? {} : { description: read('description') }),
    });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    const created = await run(
      'create',
      { url: '/api/admin/product-types', method: 'POST', body: parsed.data },
      'Product type created',
    );
    if (created !== null) setIsOpen(false);
  }

  const createButton = canWrite ? (
    <Button
      appearance="primary"
      iconBefore="plus"
      onClick={() => {
        setIsOpen(true);
      }}
    >
      New product type
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-lg">
      <ActionFailure failure={isOpen ? null : failure} />
      {productTypes.length === 0 ? (
        <EmptyState
          icon="layers"
          headingLevel={2}
          title="No product types yet"
          description="A product type, such as Apparel, defines the attributes its products have."
          action={createButton}
        />
      ) : (
        <>
          {createButton === null ? null : <div>{createButton}</div>}
          <ul aria-label="Product types" className="grid grid-cols-1 gap-md md:grid-cols-2">
            {productTypes.map((productType) => (
              <li
                key={productType.id}
                className="flex flex-col gap-xs rounded-default border border-lowlight bg-white p-lg"
              >
                <div className="flex items-center justify-between gap-sm">
                  <Link href={`/product-types/${productType.id}`} variant="body1-medium">
                    {productType.name}
                  </Link>
                  {productType.archivedAt === null ? null : <StatusBadge status="ARCHIVED" />}
                </div>
                <Text variant="body3" tone="muted">
                  Code: {productType.code}
                </Text>
                {productType.description === null ? null : (
                  <Text variant="body3">{productType.description}</Text>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <Modal
        open={isOpen}
        onOpenChange={setIsOpen}
        title="New product type"
        footer={
          <>
            <Button
              appearance="default"
              onClick={() => {
                setIsOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              appearance="primary"
              isLoading={pendingKey === 'create'}
            >
              Create product type
            </Button>
          </>
        }
      >
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-md"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <ActionFailure failure={failure} />
          <FormField label="Name" name="name" error={fieldErrors['name']} autoComplete="off" />
          <FormField
            label="Code"
            name="code"
            hint="Lower-case letters, numbers and underscores, for example apparel. It cannot change later."
            error={fieldErrors['code']}
            autoComplete="off"
          />
          <FormField label="Description (optional)" name="description" autoComplete="off" />
        </form>
      </Modal>
    </div>
  );
}
