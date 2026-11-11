'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import {
  maximumStockQuantity,
  receiveStockSchema,
  setLowStockThresholdSchema,
  stockAdjustmentSchema,
} from '@/modules/inventory/inventory.schema';
import type { IdempotencyKeeper } from './idempotency-key';
import { InventoryFailure, useInventoryAction } from './inventory-actions';
import { formatQuantity } from './inventory-format';
import {
  type StockProductView,
  type StockVariantView,
  type WarehouseChoice,
  warehouseLabel,
} from './inventory-types';

function wholeNumber(text: string): number | string {
  const trimmed = text.trim();
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

function warehouseOptions(warehouses: readonly WarehouseChoice[]) {
  return warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouseLabel(warehouse) }));
}

function DialogFooter({
  formId,
  label,
  isPending,
  isDisabled = false,
  onCancel,
}: Readonly<{
  formId: string;
  label: string;
  isPending: boolean;
  isDisabled?: boolean;
  onCancel: () => void;
}>) {
  return (
    <>
      <Button onClick={onCancel}>Cancel</Button>
      <Button
        type="submit"
        form={formId}
        appearance="primary"
        isLoading={isPending}
        disabled={isDisabled}
      >
        {label}
      </Button>
    </>
  );
}

// After a refresh the variant may have left the current view (for example "Only low stock"): its numbers
// here would be out of date, so the dialog says so and does not submit.
function StaleVariantNotice({ isStale }: Readonly<{ isStale: boolean }>) {
  if (!isStale) return null;
  return (
    <InlineAlert tone="warning">
      This variant is no longer in the current view, so the numbers here may be out of date. Close
      this window and search for it to see its current stock.
    </InlineAlert>
  );
}

type Operation = 'ADD' | 'REMOVE' | 'SET';
const operationLabels: Record<Operation, string> = {
  ADD: 'Add stock',
  REMOVE: 'Remove stock',
  SET: 'Set counted quantity',
};
const operationToasts: Record<Operation, string> = {
  ADD: 'Stock added',
  REMOVE: 'Stock removed',
  SET: 'Stock quantity set',
};

// Add, remove or set the stock of one variant in one warehouse, always with a reason. A set states the
// quantity on hand shown here, so a change made meanwhile by someone else is refused (409), not overwritten.
export function AdjustStockDialog({
  variant,
  isStale,
  warehouses,
  defaultWarehouseId,
  keeper,
  onClose,
}: Readonly<{
  variant: StockVariantView;
  isStale: boolean;
  warehouses: readonly WarehouseChoice[];
  defaultWarehouseId: string;
  keeper: IdempotencyKeeper;
  onClose: () => void;
}>) {
  const formId = 'adjust-stock-form';
  const { run, isPending, failure, clearFailure } = useInventoryAction();
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [operation, setOperation] = useState<Operation>('ADD');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const level = variant.levels.find((candidate) => candidate.warehouseId === warehouseId);
  const onHand = level?.onHandQuantity ?? 0;

  async function submit(text: (name: string) => string) {
    const location = { variantId: variant.variantId, warehouseId };
    const body =
      operation === 'SET'
        ? {
            operation,
            ...location,
            expectedOnHandQuantity: onHand,
            newOnHandQuantity: wholeNumber(text('newOnHandQuantity')),
            reason: text('reason'),
          }
        : {
            operation,
            ...location,
            quantity: wholeNumber(text('quantity')),
            reason: text('reason'),
          };
    const parsed = stockAdjustmentSchema.safeParse(body);
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    const saved = await run(
      {
        url: '/api/admin/inventory/adjustments',
        method: 'POST',
        body: parsed.data,
        idempotencyKey: keeper.keyFor(parsed.data),
      },
      operationToasts[operation],
    );
    if (saved === null) return;
    keeper.forget(parsed.data);
    onClose();
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Adjust stock: ${variant.sku}`}
      footer={
        <DialogFooter
          formId={formId}
          label={operationLabels[operation]}
          isPending={isPending}
          isDisabled={isStale}
          onCancel={onClose}
        />
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-md"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          void submit(formReader(event.currentTarget));
        }}
      >
        <StaleVariantNotice isStale={isStale} />
        <InventoryFailure failure={failure} />
        <SelectField
          label="Warehouse"
          name="warehouseId"
          options={warehouseOptions(warehouses)}
          value={warehouseId}
          onValueChange={(value) => {
            clearFailure();
            setWarehouseId(value);
          }}
          error={fieldErrors['warehouseId']}
        />
        <Text variant="body3" tone="subtitle" as="p">
          On hand here now: <strong>{formatQuantity(onHand)}</strong>
          {level === undefined
            ? ' (no stock recorded in this warehouse yet)'
            : ` · reserved ${formatQuantity(level.reservedQuantity)} · available ${formatQuantity(level.availableQuantity)}`}
        </Text>
        <SelectField
          label="Change"
          name="operation"
          options={(['ADD', 'REMOVE', 'SET'] as const).map((value) => ({
            value,
            label: operationLabels[value],
          }))}
          value={operation}
          onValueChange={(value) => {
            setFieldErrors({});
            clearFailure();
            setOperation(value === 'REMOVE' || value === 'SET' ? value : 'ADD');
          }}
        />
        {operation === 'SET' ? (
          <FormField
            key="set"
            label="Counted quantity on hand"
            name="newOnHandQuantity"
            type="number"
            inputMode="numeric"
            min={0}
            hint="The quantity you counted. It replaces the number above."
            error={fieldErrors['newOnHandQuantity'] ?? fieldErrors['expectedOnHandQuantity']}
          />
        ) : (
          <FormField
            key="delta"
            label="Quantity"
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={maximumStockQuantity}
            error={fieldErrors['quantity']}
          />
        )}
        <FormField
          label="Reason"
          name="reason"
          hint="Required. For example: damaged in transit, cycle count, found in aisle 4."
          error={fieldErrors['reason']}
          autoComplete="off"
        />
      </form>
    </Modal>
  );
}

// A supplier delivery for the variants of one product into one warehouse, applied all or nothing.
export function ReceiveStockDialog({
  product,
  warehouses,
  defaultWarehouseId,
  keeper,
  onClose,
}: Readonly<{
  product: StockProductView;
  warehouses: readonly WarehouseChoice[];
  defaultWarehouseId: string;
  keeper: IdempotencyKeeper;
  onClose: () => void;
}>) {
  const formId = 'receive-stock-form';
  const { run, isPending, failure, clearFailure } = useInventoryAction();
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [linesError, setLinesError] = useState<string | null>(null);

  async function submit(text: (name: string) => string) {
    const errors: Record<string, string> = {};
    const lines: { variantId: string; quantity: number }[] = [];
    for (const variant of product.variants) {
      const entered = text(`quantity-${variant.variantId}`).trim();
      if (entered === '') continue;
      const quantity = wholeNumber(entered);
      if (typeof quantity !== 'number' || quantity < 1 || quantity > maximumStockQuantity) {
        errors[`quantity-${variant.variantId}`] =
          `Enter a whole number from 1 to ${formatQuantity(maximumStockQuantity)}`;
        continue;
      }
      lines.push({ variantId: variant.variantId, quantity });
    }
    const parsed = receiveStockSchema.safeParse({
      warehouseId,
      supplierReference: text('supplierReference'),
      lines,
    });
    const schemaErrors = parsed.success
      ? {}
      : firstMessages(z.flattenError(parsed.error).fieldErrors);
    setFieldErrors({ ...schemaErrors, ...errors });
    // "lines" covers both an empty receipt and one over the API's line limit.
    setLinesError(
      lines.length === 0 && Object.keys(errors).length === 0
        ? 'Enter a quantity for at least one variant.'
        : (schemaErrors['lines'] ?? null),
    );
    if (!parsed.success || Object.keys(errors).length > 0) return;
    const saved = await run(
      {
        url: '/api/admin/inventory/receipts',
        method: 'POST',
        body: parsed.data,
        idempotencyKey: keeper.keyFor(parsed.data),
      },
      'Stock received',
    );
    if (saved === null) return;
    keeper.forget(parsed.data);
    onClose();
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Receive stock: ${product.productName}`}
      description="Enter what arrived from the supplier. Leave a variant empty if none arrived."
      size="lg"
      footer={
        <DialogFooter
          formId={formId}
          label="Receive stock"
          isPending={isPending}
          onCancel={onClose}
        />
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-md"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          void submit(formReader(event.currentTarget));
        }}
      >
        <InventoryFailure failure={failure} />
        <SelectField
          label="Warehouse"
          name="warehouseId"
          options={warehouseOptions(warehouses)}
          value={warehouseId}
          onValueChange={(value) => {
            clearFailure();
            setWarehouseId(value);
          }}
          error={fieldErrors['warehouseId']}
        />
        <FormField
          label="Supplier reference"
          name="supplierReference"
          hint="Invoice or delivery note number, for example PO-2026-118."
          error={fieldErrors['supplierReference']}
          autoComplete="off"
        />
        <fieldset className="flex flex-col gap-sm">
          <legend className="mb-xs text-body3-medium text-headings">Quantities received</legend>
          {linesError === null ? null : <InlineAlert tone="danger">{linesError}</InlineAlert>}
          <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
            {product.variants.map((variant) => (
              <FormField
                key={variant.variantId}
                label={variant.sku}
                name={`quantity-${variant.variantId}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={maximumStockQuantity}
                error={fieldErrors[`quantity-${variant.variantId}`]}
              />
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

// The low-stock threshold of one variant in one warehouse (0 turns the alert off). Setting the same
// value again changes nothing, so no idempotency key is needed.
export function ThresholdDialog({
  variant,
  isStale,
  warehouses,
  defaultWarehouseId,
  onClose,
}: Readonly<{
  variant: StockVariantView;
  isStale: boolean;
  warehouses: readonly WarehouseChoice[];
  defaultWarehouseId: string;
  onClose: () => void;
}>) {
  const formId = 'threshold-form';
  const { run, isPending, failure, clearFailure } = useInventoryAction();
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const current =
    variant.levels.find((candidate) => candidate.warehouseId === warehouseId)?.lowStockThreshold ??
    0;

  async function submit(text: (name: string) => string) {
    const parsed = setLowStockThresholdSchema.safeParse({
      variantId: variant.variantId,
      warehouseId,
      lowStockThreshold: wholeNumber(text('lowStockThreshold')),
    });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    const saved = await run(
      { url: '/api/admin/inventory/thresholds', method: 'PUT', body: parsed.data },
      'Low-stock threshold saved',
    );
    if (saved !== null) onClose();
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Low-stock threshold: ${variant.sku}`}
      description="You are alerted when the available quantity falls to this number or below. Use 0 to turn the alert off."
      footer={
        <DialogFooter
          formId={formId}
          label="Save threshold"
          isPending={isPending}
          isDisabled={isStale}
          onCancel={onClose}
        />
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-md"
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          void submit(formReader(event.currentTarget));
        }}
      >
        <StaleVariantNotice isStale={isStale} />
        <InventoryFailure failure={failure} />
        <SelectField
          label="Warehouse"
          name="warehouseId"
          options={warehouseOptions(warehouses)}
          value={warehouseId}
          onValueChange={(value) => {
            clearFailure();
            setWarehouseId(value);
          }}
          error={fieldErrors['warehouseId']}
        />
        <FormField
          key={warehouseId}
          label="Alert when available is at or below"
          name="lowStockThreshold"
          type="number"
          inputMode="numeric"
          min={0}
          defaultValue={String(current)}
          error={fieldErrors['lowStockThreshold']}
        />
      </form>
    </Modal>
  );
}
