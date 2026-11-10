'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { createBrandSchema, updateBrandSchema } from '@/modules/catalogue/catalogue.schema';
import { ActionFailure, useCatalogueAction } from './catalogue-actions';

export type BrandItem = Readonly<{
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  isActive: boolean;
}>;

type Editor = { mode: 'create' } | { mode: 'edit'; brand: BrandItem };
const formId = 'brand-form';

function BrandForm({
  editor,
  fieldErrors,
  onSubmit,
}: Readonly<{
  editor: Editor;
  fieldErrors: FieldErrors;
  onSubmit: (text: (name: string) => string, isActive: boolean) => void;
}>) {
  const brand = editor.mode === 'edit' ? editor.brand : null;
  const [isActive, setIsActive] = useState(brand?.isActive ?? true);
  return (
    <form
      id={formId}
      noValidate
      className="flex flex-col gap-md"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit(formReader(event.currentTarget), isActive);
      }}
    >
      <FormField
        label="Name"
        name="name"
        defaultValue={brand?.name ?? ''}
        error={fieldErrors['name']}
        autoComplete="off"
      />
      <FormField
        label="Slug (optional)"
        name="slug"
        defaultValue={brand?.slug ?? ''}
        hint="Made from the name if left empty."
        error={fieldErrors['slug']}
        autoComplete="off"
      />
      <FormField
        label="Logo URL (optional)"
        name="logoUrl"
        type="url"
        defaultValue={brand?.logoUrl ?? ''}
        error={fieldErrors['logoUrl']}
      />
      {brand === null ? null : (
        <Checkbox
          label="Active (inactive brands cannot be chosen for products)"
          checked={isActive}
          onCheckedChange={(checked) => {
            setIsActive(checked === true);
          }}
        />
      )}
    </form>
  );
}

export function BrandManager({
  brands,
  canWrite,
}: Readonly<{ brands: readonly BrandItem[]; canWrite: boolean }>) {
  const { run, pendingKey, failure, clearFailure } = useCatalogueAction();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function save(text: (name: string) => string, isActive: boolean) {
    const entered = {
      name: text('name'),
      ...(text('slug').trim() === '' ? {} : { slug: text('slug') }),
    };
    const logoUrl = text('logoUrl').trim();
    const parsed =
      editor?.mode === 'edit'
        ? updateBrandSchema.safeParse({
            ...entered,
            logoUrl: logoUrl === '' ? null : logoUrl,
            isActive,
          })
        : createBrandSchema.safeParse({ ...entered, ...(logoUrl === '' ? {} : { logoUrl }) });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    const saved = await run(
      'brand',
      editor?.mode === 'edit'
        ? { url: `/api/admin/brands/${editor.brand.id}`, method: 'PATCH', body: parsed.data }
        : { url: '/api/admin/brands', method: 'POST', body: parsed.data },
      editor?.mode === 'edit' ? 'Brand updated' : 'Brand created',
    );
    if (saved !== null) setEditor(null);
  }

  const createButton = canWrite ? (
    <Button
      appearance="primary"
      iconBefore="plus"
      onClick={() => {
        clearFailure();
        setFieldErrors({});
        setEditor({ mode: 'create' });
      }}
    >
      New brand
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-lg">
      {brands.length === 0 ? (
        <EmptyState
          icon="tag"
          headingLevel={2}
          title="No brands yet"
          description="Every product belongs to a brand."
          action={createButton}
        />
      ) : (
        <>
          {createButton === null ? null : <div>{createButton}</div>}
          <ul aria-label="Brands" className="grid grid-cols-1 gap-md md:grid-cols-2">
            {brands.map((brand) => (
              <li
                key={brand.id}
                className="flex items-center justify-between gap-sm rounded-default border border-lowlight bg-white p-md"
              >
                <div className="flex flex-col gap-xs">
                  <Text variant="body2-medium">{brand.name}</Text>
                  <Text variant="body3" tone="muted">
                    {brand.slug}
                  </Text>
                </div>
                <div className="flex items-center gap-sm">
                  <Badge tone={brand.isActive ? 'success' : 'warning'}>
                    {brand.isActive ? 'active' : 'inactive'}
                  </Badge>
                  {canWrite ? (
                    <Button
                      size="sm"
                      iconBefore="pencil"
                      onClick={() => {
                        clearFailure();
                        setFieldErrors({});
                        setEditor({ mode: 'edit', brand });
                      }}
                    >
                      Edit {brand.name}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <Modal
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        title={editor?.mode === 'edit' ? `Edit ${editor.brand.name}` : 'New brand'}
        footer={
          <>
            <Button
              onClick={() => {
                setEditor(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              appearance="primary"
              isLoading={pendingKey === 'brand'}
            >
              Save brand
            </Button>
          </>
        }
      >
        {editor === null ? null : (
          <div className="flex flex-col gap-md">
            <ActionFailure failure={failure} />
            <BrandForm
              key={editor.mode === 'edit' ? editor.brand.id : 'new'}
              editor={editor}
              fieldErrors={fieldErrors}
              onSubmit={(text, isActive) => void save(text, isActive)}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
