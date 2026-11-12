import { DomainError, type DomainErrorKind } from '@/lib/errors';

function inventoryError(kind: DomainErrorKind, code: string, message: string, details?: unknown) {
  return new DomainError({ kind, code, message, details });
}

export const inventoryErrors = {
  stockBelowReserved: (details: {
    onHandQuantity: number;
    reservedQuantity: number;
    requestedOnHandQuantity: number;
  }) =>
    inventoryError(
      'CONFLICT',
      'STOCK_BELOW_RESERVED',
      'This would leave less stock on hand than is reserved for orders.',
      details,
    ),
  staleStock: (details: { expectedOnHandQuantity: number; currentOnHandQuantity: number }) =>
    inventoryError(
      'CONFLICT',
      'STALE_STOCK',
      'The stock changed since you loaded it. Reload and try again.',
      details,
    ),
  noStockChange: () =>
    inventoryError('UNPROCESSABLE', 'NO_STOCK_CHANGE', 'This would not change the stock.'),
  onHandLimitExceeded: (details: {
    variantId: string;
    warehouseId: string;
    onHandQuantity: number;
    requestedOnHandQuantity: number;
    maximumOnHandQuantity: number;
  }) =>
    inventoryError(
      'UNPROCESSABLE',
      'ON_HAND_LIMIT_EXCEEDED',
      'This would take the stock on hand above the largest quantity allowed.',
      details,
    ),
  invalidCursor: () =>
    inventoryError('VALIDATION', 'INVALID_CURSOR', 'Use the cursor from the previous page.'),
  outOfStock: (details: {
    variantId: string;
    warehouseId: string;
    availableQuantity: number;
    requestedQuantity: number;
  }) => inventoryError('CONFLICT', 'OUT_OF_STOCK', 'Not enough stock is available.', details),
  reservationExceeded: (details: {
    shipmentId: string;
    variantId: string;
    warehouseId: string;
    remainingReservedQuantity: number;
    requestedQuantity: number;
  }) =>
    inventoryError(
      'CONFLICT',
      'RESERVATION_EXCEEDED',
      'This is more than the shipment still has reserved.',
      details,
    ),
  reservationReferenceInvalid: (details: {
    shipmentId: string;
    reason: 'SHIPMENT_NOT_FOUND' | 'OTHER_WAREHOUSE';
  }) =>
    inventoryError(
      'UNPROCESSABLE',
      'RESERVATION_REFERENCE_INVALID',
      'The shipment does not exist or belongs to another warehouse.',
      details,
    ),
  restockExceeded: (details: {
    referenceType: 'shipment' | 'return_request';
    referenceId: string;
    variantId: string;
    warehouseId: string;
    restockableQuantity: number;
    requestedQuantity: number;
  }) =>
    inventoryError(
      'CONFLICT',
      'RESTOCK_EXCEEDED',
      'This is more than can still be restocked for this shipment or return.',
      details,
    ),
  restockReferenceInvalid: (details: {
    returnRequestId: string;
    reason: 'RETURN_REQUEST_NOT_FOUND' | 'NO_RECEIVING_WAREHOUSE';
  }) =>
    inventoryError(
      'UNPROCESSABLE',
      'RESTOCK_REFERENCE_INVALID',
      'The return request does not exist or has no receiving warehouse.',
      details,
    ),
  variantNotReservable: (details: {
    variantId: string;
    productStatus: string;
    variantStatus: string;
  }) =>
    inventoryError(
      'UNPROCESSABLE',
      'VARIANT_NOT_RESERVABLE',
      'Only active variants of active products can be reserved.',
      details,
    ),
  warehouseInactive: (details: { warehouseId: string }) =>
    inventoryError(
      'UNPROCESSABLE',
      'WAREHOUSE_INACTIVE',
      'This warehouse is inactive, so stock cannot be reserved there.',
      details,
    ),
  thresholdNotAllowed: (details: {
    variantId: string;
    productStatus: string;
    variantStatus: string;
  }) =>
    inventoryError(
      'UNPROCESSABLE',
      'THRESHOLD_NOT_ALLOWED',
      'An archived product or variant can only have its low-stock threshold cleared to 0.',
      details,
    ),
  idempotencyKeyReused: () =>
    inventoryError(
      'UNPROCESSABLE',
      'IDEMPOTENCY_KEY_REUSED',
      'This request key was already used for a different change.',
    ),
  warehouseCodeTaken: () =>
    inventoryError(
      'CONFLICT',
      'WAREHOUSE_CODE_TAKEN',
      'A warehouse with this code already exists.',
    ),
  warehouseNotFound: () =>
    inventoryError('NOT_FOUND', 'WAREHOUSE_NOT_FOUND', 'This warehouse was not found.'),
  variantNotFound: () =>
    inventoryError('NOT_FOUND', 'VARIANT_NOT_FOUND', 'This variant was not found.'),
};
