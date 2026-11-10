import type { ProductStatus, ProductVariantStatus } from '@/generated/prisma/enums';

// Restoring an archived product brings it back as a DRAFT; it is re-checked before it can be ACTIVE.
export const productStatusTransitions: Record<ProductStatus, readonly ProductStatus[]> = {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

export const variantStatusTransitions: Record<
  ProductVariantStatus,
  readonly ProductVariantStatus[]
> = {
  ACTIVE: ['INACTIVE', 'ARCHIVED'],
  INACTIVE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['ACTIVE', 'INACTIVE'],
};

export function canChangeProductStatus(from: ProductStatus, to: ProductStatus): boolean {
  return productStatusTransitions[from].includes(to);
}

export function canChangeVariantStatus(
  from: ProductVariantStatus,
  to: ProductVariantStatus,
): boolean {
  return variantStatusTransitions[from].includes(to);
}

// The invariant (TD-016): an ACTIVE product always has at least one ACTIVE variant.
export function wouldLeaveActiveProductWithoutActiveVariant(input: {
  productStatus: ProductStatus;
  variantStatus: ProductVariantStatus;
  targetStatus: ProductVariantStatus;
  activeVariantCount: number;
}): boolean {
  return (
    input.productStatus === 'ACTIVE' &&
    input.variantStatus === 'ACTIVE' &&
    input.targetStatus !== 'ACTIVE' &&
    input.activeVariantCount <= 1
  );
}

export function activationProblems(input: {
  activeVariantCount: number;
  attributeProblems: readonly string[];
}): string[] {
  return [
    ...(input.activeVariantCount === 0 ? ['Add at least one active variant'] : []),
    ...input.attributeProblems,
  ];
}
