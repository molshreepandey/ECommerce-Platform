'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/atoms/EmptyState';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { FormField } from '@/components/molecules/FormField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { createWarehouseSchema, updateWarehouseSchema } from '@/modules/inventory/inventory.schema';
import { InventoryFailure, useInventoryAction } from './inventory-actions';

export type WarehouseItem = Readonly<{
  id: string;
  code: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pincode: string;
  contactName: string;
  contactPhone: string;
  priority: number;
  isActive: boolean;
}>;

type Editor = { mode: 'create' } | { mode: 'edit'; warehouse: WarehouseItem };
const formId = 'warehouse-form';

const textFields = [
  { name: 'name', label: 'Name', autoComplete: 'off' },
  { name: 'addressLine1', label: 'Address line 1', autoComplete: 'address-line1' },
  { name: 'addressLine2', label: 'Address line 2 (optional)', autoComplete: 'address-line2' },
  { name: 'city', label: 'City', autoComplete: 'address-level2' },
  { name: 'state', label: 'State', autoComplete: 'address-level1' },
  { name: 'pincode', label: 'Pincode', autoComplete: 'postal-code', inputMode: 'numeric' },
  { name: 'contactName', label: 'Contact name', autoComplete: 'off' },
  { name: 'contactPhone', label: 'Contact mobile', autoComplete: 'tel-national', inputMode: 'tel' },
] as const;

function WarehouseForm({
  editor,
  fieldErrors,
  onSubmit,
}: Readonly<{
  editor: Editor;
  fieldErrors: FieldErrors;
  onSubmit: (text: (name: string) => string) => void;
}>) {
  const warehouse = editor.mode === 'edit' ? editor.warehouse : null;
  return (
    <form
      id={formId}
      noValidate
      className="grid grid-cols-1 gap-md md:grid-cols-2"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit(formReader(event.currentTarget));
      }}
    >
      {warehouse === null ? (
        <FormField
          label="Code"
          name="code"
          hint="Letters and numbers, for example WH-PUNE-1. It cannot be changed later."
          error={fieldErrors['code']}
          autoComplete="off"
        />
      ) : null}
      {textFields.map((field) => (
        <FormField
          key={field.name}
          label={field.label}
          name={field.name}
          defaultValue={warehouse === null ? '' : (warehouse[field.name] ?? '')}
          error={fieldErrors[field.name]}
          autoComplete={field.autoComplete}
          {...('inputMode' in field ? { inputMode: field.inputMode } : {})}
        />
      ))}
      <FormField
        label="Priority"
        name="priority"
        type="number"
        inputMode="numeric"
        min={1}
        max={1000}
        hint="Lower numbers are preferred when orders are allocated."
        defaultValue={warehouse === null ? '100' : String(warehouse.priority)}
        error={fieldErrors['priority']}
      />
    </form>
  );
}

function wholeNumber(text: string): number | string {
  const trimmed = text.trim();
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

export function WarehouseManager({
  warehouses,
  canWrite,
}: Readonly<{ warehouses: readonly WarehouseItem[]; canWrite: boolean }>) {
  const { run, isPending, failure, clearFailure } = useInventoryAction();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [statusChange, setStatusChange] = useState<WarehouseItem | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  function closeEditor() {
    clearFailure();
    setFormError(null);
    setEditor(null);
  }

  async function save(text: (name: string) => string) {
    const addressLine2 = text('addressLine2').trim();
    const fields = {
      name: text('name'),
      addressLine1: text('addressLine1'),
      addressLine2: addressLine2 === '' ? null : addressLine2,
      city: text('city'),
      state: text('state'),
      pincode: text('pincode'),
      contactName: text('contactName'),
      contactPhone: text('contactPhone'),
      priority: wholeNumber(text('priority')),
    };
    // An edit sends only the fields this person changed, compared with the warehouse as it was loaded, so
    // someone else's concurrent change to another field is kept (TD-019: last save wins per field).
    const original = editor?.mode === 'edit' ? editor.warehouse : null;
    const changes =
      original === null
        ? fields
        : Object.fromEntries(
            Object.entries(fields).filter(([field, value]) => {
              const before = original[field as keyof typeof fields];
              return typeof value === 'string' ? value.trim() !== (before ?? '') : value !== before;
            }),
          );
    if (original !== null && Object.keys(changes).length === 0) {
      setFieldErrors({});
      setFormError('Nothing to save: change at least one field.');
      return;
    }
    setFormError(null);
    const parsed =
      original === null
        ? createWarehouseSchema.safeParse({ code: text('code'), ...fields })
        : updateWarehouseSchema.safeParse(changes);
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    const saved = await run(
      editor?.mode === 'edit'
        ? {
            url: `/api/admin/warehouses/${editor.warehouse.id}`,
            method: 'PATCH',
            body: parsed.data,
          }
        : { url: '/api/admin/warehouses', method: 'POST', body: parsed.data },
      editor?.mode === 'edit' ? 'Warehouse updated' : 'Warehouse created',
    );
    if (saved !== null) closeEditor();
  }

  // The dialog closes either way, so a failure shows on the page above the list.
  async function changeStatus(warehouse: WarehouseItem) {
    await run(
      {
        url: `/api/admin/warehouses/${warehouse.id}/status`,
        method: 'POST',
        body: { isActive: !warehouse.isActive },
      },
      warehouse.isActive ? 'Warehouse deactivated' : 'Warehouse activated',
    );
    setStatusChange(null);
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
      New warehouse
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-lg">
      {statusChange === null && editor === null ? <InventoryFailure failure={failure} /> : null}
      {warehouses.length === 0 ? (
        <EmptyState
          icon="warehouse"
          headingLevel={2}
          title="No warehouses yet"
          description="Stock is kept per warehouse. Add the first one to start."
          action={createButton}
        />
      ) : (
        <>
          {createButton === null ? null : <div>{createButton}</div>}
          <ul aria-label="Warehouses" className="grid grid-cols-1 gap-md lg:grid-cols-2">
            {warehouses.map((warehouse) => (
              <li
                key={warehouse.id}
                aria-label={`${warehouse.name} (${warehouse.code})`}
                className="flex flex-col gap-sm rounded-default border border-lowlight bg-white p-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-sm">
                  <div className="flex min-w-0 flex-col gap-xs">
                    <Text variant="body2-medium">{warehouse.name}</Text>
                    <Text variant="body3" tone="muted">
                      {warehouse.code} · priority {warehouse.priority}
                    </Text>
                  </div>
                  <Badge tone={warehouse.isActive ? 'success' : 'warning'}>
                    {warehouse.isActive ? 'active' : 'inactive'}
                  </Badge>
                </div>
                <Text variant="body3" tone="subtitle">
                  {[warehouse.addressLine1, warehouse.addressLine2, warehouse.city, warehouse.state]
                    .filter((part) => part !== null && part !== '')
                    .join(', ')}{' '}
                  {warehouse.pincode}
                </Text>
                <Text variant="body3" tone="muted">
                  Contact: {warehouse.contactName}, {warehouse.contactPhone}
                </Text>
                {warehouse.isActive ? null : (
                  <Text variant="body3" tone="warning">
                    Inactive: no new orders are allocated here. Stock and reservations are kept.
                  </Text>
                )}
                {canWrite ? (
                  <div className="flex flex-wrap gap-sm">
                    <Button
                      size="sm"
                      iconBefore="pencil"
                      aria-label={`Edit ${warehouse.name}`}
                      onClick={() => {
                        clearFailure();
                        setFieldErrors({});
                        setEditor({ mode: 'edit', warehouse });
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      iconBefore={warehouse.isActive ? 'archive' : 'restore'}
                      aria-label={`${warehouse.isActive ? 'Deactivate' : 'Activate'} ${warehouse.name}`}
                      onClick={() => {
                        clearFailure();
                        setStatusChange(warehouse);
                      }}
                    >
                      {warehouse.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
      <Modal
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        title={editor?.mode === 'edit' ? `Edit ${editor.warehouse.name}` : 'New warehouse'}
        size="lg"
        footer={
          <>
            <Button onClick={closeEditor}>Cancel</Button>
            <Button type="submit" form={formId} appearance="primary" isLoading={isPending}>
              Save warehouse
            </Button>
          </>
        }
      >
        {editor === null ? null : (
          <div className="flex flex-col gap-md">
            <InventoryFailure failure={failure} />
            {formError === null ? null : <InlineAlert tone="warning">{formError}</InlineAlert>}
            <WarehouseForm
              key={editor.mode === 'edit' ? editor.warehouse.id : 'new'}
              editor={editor}
              fieldErrors={fieldErrors}
              onSubmit={(text) => void save(text)}
            />
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={statusChange !== null}
        onOpenChange={(open) => {
          if (!open) setStatusChange(null);
        }}
        title={
          statusChange === null
            ? ''
            : `${statusChange.isActive ? 'Deactivate' : 'Activate'} ${statusChange.name}?`
        }
        description={
          statusChange?.isActive === true
            ? 'New orders will no longer be allocated to this warehouse and its stock stops counting as available. Stock on hand and existing reservations are kept.'
            : 'New orders can be allocated to this warehouse again and its stock counts as available.'
        }
        confirmLabel={statusChange?.isActive === true ? 'Deactivate' : 'Activate'}
        isPending={isPending}
        onConfirm={() => {
          if (statusChange !== null) void changeStatus(statusChange);
        }}
      />
    </div>
  );
}
