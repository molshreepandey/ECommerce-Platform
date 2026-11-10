'use client';

import { type SubmitEvent, useId, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { EmptyState } from '@/components/atoms/EmptyState';
import { fieldControlClassNames } from '@/components/atoms/field-control';
import { Heading } from '@/components/atoms/Heading';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import {
  createAttributeDefinitionSchema,
  updateAttributeDefinitionSchema,
  updateProductTypeSchema,
} from '@/modules/catalogue/catalogue.schema';
import { ActionFailure, StatusBadge, useCatalogueAction } from './catalogue-actions';
import type { ProductTypeListItem } from './ProductTypeManager';

export type AttributeDefinitionItem = Readonly<{
  id: string;
  code: string;
  label: string;
  dataType: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'ENUM' | 'MULTI_ENUM';
  scope: 'PRODUCT' | 'VARIANT_OPTION';
  isRequired: boolean;
  isFilterable: boolean;
  isSearchable: boolean;
  allowedValues: readonly string[] | null;
  displayOrder: number;
  archivedAt: Date | null;
}>;

type Flags = { isRequired: boolean; isFilterable: boolean; isSearchable: boolean };
type Editor = { mode: 'create' } | { mode: 'edit'; definition: AttributeDefinitionItem };

const dataTypeOptions = [
  { value: 'TEXT', label: 'Text' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'BOOLEAN', label: 'Yes / no' },
  { value: 'ENUM', label: 'Single choice' },
  { value: 'MULTI_ENUM', label: 'Multiple choice' },
] as const;
const scopeOptions = [
  { value: 'PRODUCT', label: 'Product attribute' },
  { value: 'VARIANT_OPTION', label: 'Variant option (size, colour…)' },
] as const;
const dataTypeLabels = Object.fromEntries(
  dataTypeOptions.map(({ value, label }) => [value, label]),
);
const formId = 'attribute-definition-form';

function allowedValuesFrom(text: string): string[] | undefined {
  const values = text
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  return values.length === 0 ? undefined : values;
}

function AllowedValuesField({
  defaultValue,
  error,
}: Readonly<{ defaultValue: string; error: string | undefined }>) {
  const fieldId = useId();
  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={fieldId} className="text-body2-medium text-headings">
        Allowed values (one per line, for choice attributes)
      </label>
      <textarea
        id={fieldId}
        name="allowedValues"
        rows={4}
        defaultValue={defaultValue}
        aria-invalid={error !== undefined}
        {...(error === undefined ? {} : { 'aria-describedby': `${fieldId}-error` })}
        className={`${fieldControlClassNames({ size: 'md', isInvalid: error !== undefined })} h-auto py-sm`}
      />
      {error === undefined ? null : (
        <Text id={`${fieldId}-error`} variant="body3" tone="danger">
          {error}
        </Text>
      )}
    </div>
  );
}

function DefinitionForm({
  editor,
  onSubmit,
  fieldErrors,
}: Readonly<{
  editor: Editor;
  onSubmit: (input: {
    text: (name: string) => string;
    dataType: string;
    scope: string;
    flags: Flags;
  }) => void;
  fieldErrors: FieldErrors;
}>) {
  const existing = editor.mode === 'edit' ? editor.definition : null;
  const [dataType, setDataType] = useState<string>(existing?.dataType ?? 'ENUM');
  const [scope, setScope] = useState<string>(existing?.scope ?? 'PRODUCT');
  const [flags, setFlags] = useState<Flags>({
    isRequired: existing?.isRequired ?? false,
    isFilterable: existing?.isFilterable ?? false,
    isSearchable: existing?.isSearchable ?? false,
  });
  return (
    <form
      id={formId}
      noValidate
      className="flex flex-col gap-md"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ text: formReader(event.currentTarget), dataType, scope, flags });
      }}
    >
      <FormField
        label="Label"
        name="label"
        defaultValue={existing?.label ?? ''}
        error={fieldErrors['label']}
        autoComplete="off"
      />
      {existing === null ? (
        <>
          <FormField
            label="Code"
            name="code"
            hint="For example fabric or size. Code, type and scope cannot change later."
            error={fieldErrors['code']}
            autoComplete="off"
          />
          <SelectField
            label="Data type"
            name="dataType"
            options={dataTypeOptions}
            value={dataType}
            onValueChange={setDataType}
            error={fieldErrors['dataType']}
          />
          <SelectField
            label="Scope"
            name="scope"
            options={scopeOptions}
            value={scope}
            onValueChange={setScope}
            error={fieldErrors['scope']}
          />
        </>
      ) : (
        <Text variant="body3" tone="muted">
          Code {existing.code} · {dataTypeLabels[existing.dataType]} ·{' '}
          {existing.scope === 'PRODUCT' ? 'product attribute' : 'variant option'}
        </Text>
      )}
      {dataType === 'ENUM' || dataType === 'MULTI_ENUM' ? (
        <AllowedValuesField
          defaultValue={(existing?.allowedValues ?? []).join('\n')}
          error={fieldErrors['allowedValues']}
        />
      ) : null}
      <FormField
        label="Display order"
        name="displayOrder"
        type="number"
        defaultValue={String(existing?.displayOrder ?? 0)}
        error={fieldErrors['displayOrder']}
      />
      <div className="flex flex-wrap gap-lg">
        {(['isRequired', 'isFilterable', 'isSearchable'] as const).map((flag) => (
          <Checkbox
            key={flag}
            label={
              { isRequired: 'Required', isFilterable: 'Filterable', isSearchable: 'Searchable' }[
                flag
              ]
            }
            checked={flags[flag]}
            onCheckedChange={(checked) => {
              setFlags({ ...flags, [flag]: checked === true });
            }}
          />
        ))}
      </div>
    </form>
  );
}

export function AttributeDefinitionManager({
  productType,
  definitions,
  canWrite,
}: Readonly<{
  productType: ProductTypeListItem;
  definitions: readonly AttributeDefinitionItem[];
  canWrite: boolean;
}>) {
  const { run, pendingKey, failure, clearFailure } = useCatalogueAction();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [toArchive, setToArchive] = useState<AttributeDefinitionItem | null>(null);
  const [confirmTypeArchive, setConfirmTypeArchive] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const isArchived = productType.archivedAt !== null;
  const canChange = canWrite && !isArchived;

  async function saveDefinition(input: {
    text: (name: string) => string;
    dataType: string;
    scope: string;
    flags: Flags;
  }) {
    const allowedValues = allowedValuesFrom(input.text('allowedValues'));
    const shared = {
      label: input.text('label'),
      displayOrder: Number(input.text('displayOrder') || '0'),
      ...input.flags,
      ...(allowedValues === undefined ? {} : { allowedValues }),
    };
    const parsed =
      editor?.mode === 'edit'
        ? updateAttributeDefinitionSchema.safeParse(shared)
        : createAttributeDefinitionSchema.safeParse({
            ...shared,
            code: input.text('code'),
            dataType: input.dataType,
            scope: input.scope,
          });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    const request =
      editor?.mode === 'edit'
        ? {
            url: `/api/admin/attribute-definitions/${editor.definition.id}`,
            method: 'PATCH' as const,
            body: parsed.data,
          }
        : {
            url: `/api/admin/product-types/${productType.id}/attribute-definitions`,
            method: 'POST' as const,
            body: parsed.data,
          };
    const saved = await run(
      'definition',
      request,
      editor?.mode === 'edit' ? 'Attribute updated' : 'Attribute added',
    );
    if (saved !== null) setEditor(null);
  }

  async function renameType(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const read = formReader(event.currentTarget);
    const parsed = updateProductTypeSchema.safeParse({
      name: read('name'),
      description: read('description'),
    });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    const saved = await run(
      'rename',
      { url: `/api/admin/product-types/${productType.id}`, method: 'PATCH', body: parsed.data },
      'Product type updated',
    );
    if (saved !== null) setRenaming(false);
  }

  const activeDefinitions = definitions.filter((definition) => definition.archivedAt === null);

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center gap-sm">
        <Text variant="body3" tone="muted">
          Code: {productType.code}
        </Text>
        {isArchived ? <StatusBadge status="ARCHIVED" /> : null}
      </div>
      {editor === null && !renaming ? <ActionFailure failure={failure} /> : null}
      {canWrite ? (
        <div className="flex flex-wrap gap-sm">
          {isArchived ? (
            <Button
              iconBefore="restore"
              isLoading={pendingKey === 'restore'}
              onClick={() =>
                void run(
                  'restore',
                  { url: `/api/admin/product-types/${productType.id}/restore`, method: 'POST' },
                  'Product type restored',
                )
              }
            >
              Restore product type
            </Button>
          ) : (
            <>
              <Button
                appearance="primary"
                iconBefore="plus"
                onClick={() => {
                  clearFailure();
                  setFieldErrors({});
                  setEditor({ mode: 'create' });
                }}
              >
                Add attribute
              </Button>
              <Button
                iconBefore="pencil"
                onClick={() => {
                  clearFailure();
                  setRenaming(true);
                }}
              >
                Rename
              </Button>
              <Button
                appearance="subtle"
                iconBefore="archive"
                onClick={() => {
                  setConfirmTypeArchive(true);
                }}
              >
                Archive product type
              </Button>
            </>
          )}
        </div>
      ) : null}

      <Heading level={2} variant="heading4">
        Attributes
      </Heading>
      {activeDefinitions.length === 0 ? (
        <EmptyState
          icon="layers"
          headingLevel={2}
          title="No attributes yet"
          description="Add attributes such as fabric, or variant options such as size."
        />
      ) : (
        <ul aria-label="Attributes" className="flex flex-col gap-sm">
          {activeDefinitions.map((definition) => (
            <li
              key={definition.id}
              className="flex flex-col gap-sm rounded-default border border-lowlight bg-white p-md md:flex-row md:items-center md:justify-between"
            >
              <div className="flex flex-col gap-xs">
                <Text variant="body2-medium">
                  {definition.label} <span className="text-text-muted">({definition.code})</span>
                </Text>
                <Text variant="body3" tone="muted">
                  {dataTypeLabels[definition.dataType]} ·{' '}
                  {definition.scope === 'PRODUCT' ? 'product attribute' : 'variant option'}
                  {definition.isRequired ? ' · required' : ''}
                  {definition.allowedValues === null
                    ? ''
                    : ` · ${definition.allowedValues.join(', ')}`}
                </Text>
              </div>
              {canChange ? (
                <div className="flex gap-xs">
                  <Button
                    size="sm"
                    iconBefore="pencil"
                    onClick={() => {
                      clearFailure();
                      setFieldErrors({});
                      setEditor({ mode: 'edit', definition });
                    }}
                  >
                    Edit {definition.label}
                  </Button>
                  <Button
                    size="sm"
                    appearance="subtle"
                    iconBefore="archive"
                    onClick={() => {
                      setToArchive(definition);
                    }}
                  >
                    Archive {definition.label}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        title={editor?.mode === 'edit' ? `Edit ${editor.definition.label}` : 'Add attribute'}
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
              isLoading={pendingKey === 'definition'}
            >
              Save attribute
            </Button>
          </>
        }
      >
        {editor === null ? null : (
          <div className="flex flex-col gap-md">
            <ActionFailure failure={failure} />
            <DefinitionForm
              key={editor.mode === 'edit' ? editor.definition.id : 'new'}
              editor={editor}
              fieldErrors={fieldErrors}
              onSubmit={(input) => void saveDefinition(input)}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename product type"
        footer={
          <>
            <Button
              onClick={() => {
                setRenaming(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="rename-product-type"
              appearance="primary"
              isLoading={pendingKey === 'rename'}
            >
              Save
            </Button>
          </>
        }
      >
        <form
          id="rename-product-type"
          noValidate
          className="flex flex-col gap-md"
          onSubmit={(event) => void renameType(event)}
        >
          <ActionFailure failure={failure} />
          <FormField
            label="Name"
            name="name"
            defaultValue={productType.name}
            error={fieldErrors['name']}
          />
          <FormField
            label="Description"
            name="description"
            defaultValue={productType.description ?? ''}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={toArchive !== null}
        onOpenChange={(open) => {
          if (!open) setToArchive(null);
        }}
        title={`Archive ${toArchive?.label ?? 'attribute'}?`}
        description="Products keep the values they already have, but new products will not ask for it. This cannot be undone; create a new attribute instead."
        confirmLabel="Archive attribute"
        isPending={pendingKey === 'archive-definition'}
        onConfirm={() => {
          if (toArchive === null) return;
          void run(
            'archive-definition',
            { url: `/api/admin/attribute-definitions/${toArchive.id}/archive`, method: 'POST' },
            'Attribute archived',
          ).then(() => {
            setToArchive(null);
          });
        }}
      />
      <ConfirmDialog
        open={confirmTypeArchive}
        onOpenChange={setConfirmTypeArchive}
        title={`Archive ${productType.name}?`}
        description="Only possible when every product of this type is archived. You can restore it later."
        confirmLabel="Archive product type"
        isPending={pendingKey === 'archive-type'}
        onConfirm={() => {
          void run(
            'archive-type',
            { url: `/api/admin/product-types/${productType.id}/archive`, method: 'POST' },
            'Product type archived',
          ).then(() => {
            setConfirmTypeArchive(false);
          });
        }}
      />
    </div>
  );
}
