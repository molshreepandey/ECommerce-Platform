import { z } from 'zod';

import {
  returnRequestIdSchema,
  shipmentIdSchema,
  variantIdSchema,
  warehouseIdSchema,
} from '@/lib/ids';
import { indianMobileSchema, indianPincodeSchema } from '@/modules/identity/identity.schema';

export const maximumStockQuantity = 100_000;
export const maximumOnHandQuantity = 1_000_000;
export const maximumLowStockThreshold = 100_000;
export const maximumLinesPerRequest = 100;
export const maximumListLimit = 100;

// Mirrors the database rule reason ~ '[[:alnum:]]': at least one letter or digit in any script, so
// text made only of whitespace (tabs, newlines, non-breaking or zero-width spaces) or punctuation is refused.
const letterOrDigitPattern = /[\p{L}\p{Nd}]/u;
const hasLetterOrDigit = (text: string) => letterOrDigitPattern.test(text);

export const stockReasonSchema = z
  .string()
  .trim()
  .min(3, 'Enter a reason of at least 3 characters')
  .max(500)
  .refine(hasLetterOrDigit, { message: 'Include at least one letter or digit' });

export const supplierReferenceSchema = z
  .string()
  .trim()
  .min(1, 'Enter the supplier reference')
  .max(100)
  .refine(hasLetterOrDigit, { message: 'Include at least one letter or digit' });

export const stockQuantitySchema = z
  .int('Enter a whole number')
  .min(1, 'Enter a quantity of at least 1')
  .max(maximumStockQuantity);

export const onHandQuantitySchema = z.int('Enter a whole number').min(0).max(maximumOnHandQuantity);

// Same rule as the database CHECK on inventory_change_requests.idempotency_key.
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,100}$/, 'Use 16 to 100 letters, digits, hyphens or underscores');

const stockLocation = { variantId: variantIdSchema, warehouseId: warehouseIdSchema };

// z.uuid() accepts upper-case hex, while PostgreSQL returns ids in lower case. Receipts and thresholds
// match their input against ids read back from the database (map lookups, "each variant once"), so their
// ids are lower-cased first. Adjustments keep the shared schemas: they never look ids up in such a map,
// and an id's letter case stays part of their idempotency fingerprint (TD-020).
const lowerCaseVariantIdSchema = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(variantIdSchema);
const lowerCaseWarehouseIdSchema = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(warehouseIdSchema);

export const addStockSchema = z.strictObject({
  ...stockLocation,
  quantity: stockQuantitySchema,
  reason: stockReasonSchema,
});
export type AddStockInput = z.infer<typeof addStockSchema>;

export const removeStockSchema = addStockSchema;
export type RemoveStockInput = z.infer<typeof removeStockSchema>;

export const setStockSchema = z.strictObject({
  ...stockLocation,
  expectedOnHandQuantity: onHandQuantitySchema,
  newOnHandQuantity: onHandQuantitySchema,
  reason: stockReasonSchema,
});
export type SetStockInput = z.infer<typeof setStockSchema>;

// One HTTP body for the three manual adjustments; `operation` picks the rule and is not passed on (the
// service's own operation name is part of the idempotency fingerprint).
export const stockAdjustmentSchema = z.discriminatedUnion('operation', [
  addStockSchema.extend({ operation: z.literal('ADD') }),
  removeStockSchema.extend({ operation: z.literal('REMOVE') }),
  setStockSchema.extend({ operation: z.literal('SET') }),
]);
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

// Lines are sorted by variant, so the same receipt always has the same fingerprint and lock order.
export const receiveStockSchema = z.strictObject({
  warehouseId: lowerCaseWarehouseIdSchema,
  supplierReference: supplierReferenceSchema,
  lines: z
    .array(z.strictObject({ variantId: lowerCaseVariantIdSchema, quantity: stockQuantitySchema }))
    .min(1, 'Add at least one line')
    .max(maximumLinesPerRequest)
    .refine((lines) => new Set(lines.map(({ variantId }) => variantId)).size === lines.length, {
      message: 'Each variant once',
    })
    .transform((lines) =>
      [...lines].sort((left, right) => left.variantId.localeCompare(right.variantId)),
    ),
});
export type ReceiveStockInput = z.infer<typeof receiveStockSchema>;

export const setLowStockThresholdSchema = z.strictObject({
  variantId: lowerCaseVariantIdSchema,
  warehouseId: lowerCaseWarehouseIdSchema,
  lowStockThreshold: z.int('Enter a whole number').min(0).max(maximumLowStockThreshold),
});
export type SetLowStockThresholdInput = z.infer<typeof setLowStockThresholdSchema>;

const warehouseFields = {
  name: z.string().trim().min(2, 'Enter a name').max(100),
  addressLine1: z.string().trim().min(3, 'Enter the street address').max(200),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(2, 'Enter the city').max(100),
  state: z.string().trim().min(2, 'Enter the state').max(100),
  pincode: indianPincodeSchema,
  contactName: z.string().trim().min(2, 'Enter the contact name').max(100),
  contactPhone: indianMobileSchema,
  priority: z.int('Enter a whole number').min(1).max(1_000),
};

export const createWarehouseSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .max(20)
    .regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/, 'Use letters and numbers joined by single hyphens'),
  ...warehouseFields,
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

// Partial: only the submitted fields are written (concurrent edits of the same field: last save wins).
export const updateWarehouseSchema = z
  .strictObject(warehouseFields)
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Change at least one field',
  });
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;

export const changeWarehouseStatusSchema = z.strictObject({ isActive: z.boolean() });
export type ChangeWarehouseStatusInput = z.infer<typeof changeWarehouseStatusSchema>;

const reservationLineSchema = z.strictObject({
  shipmentId: shipmentIdSchema,
  ...stockLocation,
  quantity: stockQuantitySchema,
});
export type ReservationLine = z.infer<typeof reservationLineSchema>;

const reservationLinesSchema = z
  .array(reservationLineSchema)
  .max(maximumLinesPerRequest)
  .refine(
    (lines) =>
      new Set(lines.map((line) => `${line.shipmentId}/${line.variantId}/${line.warehouseId}`))
        .size === lines.length,
    { message: 'Each shipment, variant and warehouse once' },
  );

export const reservationChangesSchema = z
  .strictObject({
    reserve: reservationLinesSchema.default([]),
    release: reservationLinesSchema.default([]),
  })
  .refine((changes) => changes.reserve.length + changes.release.length > 0, {
    message: 'Add at least one line',
  })
  // A release is checked against the movements recorded before the call, so one call never reserves and
  // releases the same shipment, variant and warehouse.
  .refine(
    (changes) => {
      const reserved = new Set(
        changes.reserve.map((line) => `${line.shipmentId}/${line.variantId}/${line.warehouseId}`),
      );
      return changes.release.every(
        (line) => !reserved.has(`${line.shipmentId}/${line.variantId}/${line.warehouseId}`),
      );
    },
    { message: 'Do not reserve and release the same shipment, variant and warehouse in one call' },
  );
export type ReservationChanges = z.infer<typeof reservationChangesSchema>;
// What callers pass: either list may be left out.
export type ReservationChangesInput = z.input<typeof reservationChangesSchema>;

// Dispatch and restock lines are matched against ids read back from the database (shipment warehouses,
// ledger sums), so their ids are lower-cased first, as for receipts and thresholds.
const lowerCaseShipmentIdSchema = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(shipmentIdSchema);
const lowerCaseReturnRequestIdSchema = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(returnRequestIdSchema);

const shipmentStockLineSchema = z.strictObject({
  shipmentId: lowerCaseShipmentIdSchema,
  variantId: lowerCaseVariantIdSchema,
  warehouseId: lowerCaseWarehouseIdSchema,
  quantity: stockQuantitySchema,
});

export const shipmentStockLinesSchema = z
  .array(shipmentStockLineSchema)
  .min(1, 'Add at least one line')
  .max(maximumLinesPerRequest)
  .refine(
    (lines) =>
      new Set(lines.map((line) => `${line.shipmentId}/${line.variantId}/${line.warehouseId}`))
        .size === lines.length,
    { message: 'Each shipment, variant and warehouse once' },
  );
export type ShipmentStockLine = z.infer<typeof shipmentStockLineSchema>;
export type ShipmentStockLineInput = z.input<typeof shipmentStockLineSchema>;

const customerReturnLineSchema = z.strictObject({
  returnRequestId: lowerCaseReturnRequestIdSchema,
  variantId: lowerCaseVariantIdSchema,
  quantity: stockQuantitySchema,
});

export const customerReturnLinesSchema = z
  .array(customerReturnLineSchema)
  .min(1, 'Add at least one line')
  .max(maximumLinesPerRequest)
  .refine(
    (lines) =>
      new Set(lines.map((line) => `${line.returnRequestId}/${line.variantId}`)).size ===
      lines.length,
    { message: 'Each return request and variant once' },
  );
export type CustomerReturnLine = z.infer<typeof customerReturnLineSchema>;
export type CustomerReturnLineInput = z.input<typeof customerReturnLineSchema>;

const queryFlag = z.enum(['true', 'false']).transform((value) => value === 'true');
const queryTimestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const queryLimit = z.coerce.number().int().min(1).max(maximumListLimit).default(50);

export const listMovementsSchema = z.strictObject({
  warehouseId: warehouseIdSchema.optional(),
  variantId: variantIdSchema.optional(),
  movementType: z
    .enum([
      'RESERVE',
      'RELEASE',
      'DISPATCH',
      'RETURN_RESTOCK',
      'RTO_RESTOCK',
      'ADJUSTMENT',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'RECEIPT',
    ])
    .optional(),
  createdFrom: queryTimestamp.optional(),
  createdTo: queryTimestamp.optional(),
  cursor: z.uuid().optional(),
  limit: queryLimit,
});
export type ListMovementsInput = z.infer<typeof listMovementsSchema>;

// The low-stock list is ordered by (warehouse, variant), the same order as its partial index, so its
// cursor is the last row's "warehouseId/variantId".
const uuidText = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const lowStockCursorSchema = z
  .string()
  .regex(new RegExp(`^${uuidText}/${uuidText}$`), 'Use the cursor from the previous page')
  .transform((cursor) => {
    const [warehouseId = '', variantId = ''] = cursor.toLowerCase().split('/');
    return { warehouseId, variantId };
  });

export const listLowStockSchema = z.strictObject({
  warehouseId: warehouseIdSchema.optional(),
  includeInactiveWarehouses: queryFlag.default(false),
  cursor: lowStockCursorSchema.optional(),
  limit: queryLimit,
});
export type ListLowStockInput = z.infer<typeof listLowStockSchema>;

export const listStockLevelsSchema = z.strictObject({
  search: z.string().trim().min(1).max(100).optional(),
  warehouseId: warehouseIdSchema.optional(),
  lowStockOnly: queryFlag.default(false),
  cursor: z.uuid().optional(),
  limit: queryLimit,
});
export type ListStockLevelsInput = z.infer<typeof listStockLevelsSchema>;
