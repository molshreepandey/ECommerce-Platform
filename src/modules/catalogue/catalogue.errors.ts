import { DomainError } from '@/lib/errors';

type CatalogueEntity =
  'PRODUCT_TYPE' | 'ATTRIBUTE_DEFINITION' | 'BRAND' | 'PRODUCT' | 'VARIANT' | 'MEDIA';

const entityLabels: Record<CatalogueEntity, string> = {
  PRODUCT_TYPE: 'product type',
  ATTRIBUTE_DEFINITION: 'attribute',
  BRAND: 'brand',
  PRODUCT: 'product',
  VARIANT: 'variant',
  MEDIA: 'image',
};

export class CatalogueNotFoundError extends DomainError {
  constructor(entity: CatalogueEntity) {
    super({
      kind: 'NOT_FOUND',
      code: `${entity}_NOT_FOUND`,
      message: `This ${entityLabels[entity]} was not found.`,
    });
  }
}

export class CatalogueValidationError extends DomainError {
  constructor(fieldErrors: Readonly<Record<string, readonly string[]>>) {
    super({
      kind: 'VALIDATION',
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: { fieldErrors },
    });
  }
}

export class CatalogueConflictError extends DomainError {
  constructor(code: string, message: string, details?: unknown) {
    super({ kind: 'CONFLICT', code, message, details });
  }
}

export class CatalogueUnprocessableError extends DomainError {
  constructor(code: string, message: string, details?: unknown) {
    super({ kind: 'UNPROCESSABLE', code, message, details });
  }
}

export const catalogueConflicts = {
  productTypeCodeTaken: () =>
    new CatalogueConflictError(
      'PRODUCT_TYPE_CODE_TAKEN',
      'A product type with this code already exists.',
    ),
  attributeCodeTaken: () =>
    new CatalogueConflictError(
      'ATTRIBUTE_CODE_TAKEN',
      'This product type already has an attribute with this code.',
    ),
  brandSlugTaken: () =>
    new CatalogueConflictError('BRAND_SLUG_TAKEN', 'A brand with this slug already exists.'),
  productSlugTaken: () =>
    new CatalogueConflictError('PRODUCT_SLUG_TAKEN', 'A product with this slug already exists.'),
  skuTaken: (sku?: string) =>
    new CatalogueConflictError(
      'SKU_TAKEN',
      'A variant with this SKU already exists.',
      sku === undefined ? undefined : { sku },
    ),
  duplicateVariantCombination: (optionSignature: string) =>
    new CatalogueConflictError(
      'DUPLICATE_VARIANT_COMBINATION',
      'This product already has a variant with these options. Restore it instead of creating it again.',
      { optionSignature },
    ),
  staleProduct: () =>
    new CatalogueConflictError(
      'STALE_PRODUCT',
      'Someone else changed this product. Reload it and try again.',
    ),
  invalidStatusTransition: (from: string, to: string) =>
    new CatalogueConflictError(
      'INVALID_STATUS_TRANSITION',
      `A ${from.toLowerCase()} item cannot become ${to.toLowerCase()}.`,
      { from, to },
    ),
  productArchived: () =>
    new CatalogueConflictError(
      'PRODUCT_ARCHIVED',
      'This product is archived. Restore it before changing it.',
    ),
  productTypeArchived: () =>
    new CatalogueConflictError(
      'PRODUCT_TYPE_ARCHIVED',
      'This product type is archived. Restore it before using or changing it.',
    ),
  productTypeNotArchived: () =>
    new CatalogueConflictError('PRODUCT_TYPE_NOT_ARCHIVED', 'This product type is not archived.'),
  attributeDefinitionArchived: () =>
    new CatalogueConflictError(
      'ATTRIBUTE_DEFINITION_ARCHIVED',
      'This attribute is archived and can no longer be changed. Create a new one instead.',
    ),
  productTypeInUse: (productCount: number) =>
    new CatalogueConflictError(
      'PRODUCT_TYPE_IN_USE',
      'Archive every product of this type before archiving the type.',
      { productCount },
    ),
  slugLocked: () =>
    new CatalogueConflictError(
      'PRODUCT_SLUG_LOCKED',
      'The slug can only change while the product is a draft.',
    ),
  lastActiveVariant: () =>
    new CatalogueConflictError(
      'LAST_ACTIVE_VARIANT',
      'An active product needs at least one active variant. Move the product to draft first.',
    ),
  attributeValueInUse: (valuesInUse: readonly string[]) =>
    new CatalogueConflictError(
      'ATTRIBUTE_VALUE_IN_USE',
      'Some allowed values are still used by products or variants.',
      { valuesInUse },
    ),
  attributeRequiredButMissing: (missingCount: number) =>
    new CatalogueConflictError(
      'ATTRIBUTE_REQUIRED_BUT_MISSING',
      'Some existing products or variants have no value for this attribute yet.',
      { missingCount },
    ),
  attributeInUse: (variantCount: number) =>
    new CatalogueConflictError(
      'ATTRIBUTE_IN_USE',
      'Variants still use this option. Archive those variants first.',
      { variantCount },
    ),
  variantArchived: () =>
    new CatalogueConflictError(
      'VARIANT_ARCHIVED',
      'This variant is archived. Restore it before changing it.',
    ),
  mediaLimitReached: (limit: number) =>
    new CatalogueConflictError(
      'MEDIA_LIMIT_REACHED',
      `A product can have at most ${limit} images.`,
      { limit },
    ),
  staleMediaOrder: () =>
    new CatalogueConflictError(
      'STALE_MEDIA_ORDER',
      'The images changed while you were reordering them. Reload and try again.',
    ),
} as const;

export const catalogueUnprocessable = {
  productNotReady: (reasons: readonly string[]) =>
    new CatalogueUnprocessableError('PRODUCT_NOT_READY', 'This product cannot be activated yet.', {
      reasons,
    }),
  brandInactive: () =>
    new CatalogueUnprocessableError(
      'BRAND_INACTIVE',
      'This brand is inactive. Choose an active brand.',
    ),
  variantOptionsOutdated: (fieldErrors: Readonly<Record<string, readonly string[]>>) =>
    new CatalogueUnprocessableError(
      'VARIANT_OPTIONS_OUTDATED',
      'This variant’s options are no longer allowed by its product type, so it cannot be restored.',
      { fieldErrors },
    ),
  variantNotInProduct: () =>
    new CatalogueUnprocessableError(
      'VARIANT_NOT_IN_PRODUCT',
      'The chosen variant does not belong to this product.',
    ),
} as const;
