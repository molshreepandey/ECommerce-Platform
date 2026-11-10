import { describe, expect, it } from 'vitest';

import type { ProductStatus, ProductVariantStatus } from '@/generated/prisma/enums';

import {
  activationProblems,
  canChangeProductStatus,
  canChangeVariantStatus,
  wouldLeaveActiveProductWithoutActiveVariant,
} from './product-lifecycle';

const productStatuses: ProductStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];
const variantStatuses: ProductVariantStatus[] = ['ACTIVE', 'INACTIVE', 'ARCHIVED'];

describe('product status transitions', () => {
  it.each([
    ['DRAFT', 'ACTIVE', true],
    ['DRAFT', 'ARCHIVED', true],
    ['ACTIVE', 'DRAFT', true],
    ['ACTIVE', 'ARCHIVED', true],
    ['ARCHIVED', 'DRAFT', true],
    ['ARCHIVED', 'ACTIVE', false],
  ] as const)('%s → %s allowed: %s', (from, to, allowed) => {
    expect(canChangeProductStatus(from, to)).toBe(allowed);
  });

  it('never allows a "change" to the same status', () => {
    for (const status of productStatuses)
      expect(canChangeProductStatus(status, status)).toBe(false);
    for (const status of variantStatuses)
      expect(canChangeVariantStatus(status, status)).toBe(false);
  });

  it('allows every variant status to reach every other one', () => {
    for (const from of variantStatuses) {
      for (const to of variantStatuses.filter((status) => status !== from)) {
        expect(canChangeVariantStatus(from, to), `${from} → ${to}`).toBe(true);
      }
    }
  });
});

describe('wouldLeaveActiveProductWithoutActiveVariant', () => {
  const lastActiveOfActiveProduct = {
    productStatus: 'ACTIVE',
    variantStatus: 'ACTIVE',
    activeVariantCount: 1,
  } as const;

  it('blocks archiving or deactivating the last active variant of an ACTIVE product', () => {
    for (const targetStatus of ['ARCHIVED', 'INACTIVE'] as const) {
      expect(
        wouldLeaveActiveProductWithoutActiveVariant({ ...lastActiveOfActiveProduct, targetStatus }),
      ).toBe(true);
    }
  });

  it('allows it when another active variant remains, the product is a draft, or the variant is not active', () => {
    expect(
      wouldLeaveActiveProductWithoutActiveVariant({
        ...lastActiveOfActiveProduct,
        activeVariantCount: 2,
        targetStatus: 'ARCHIVED',
      }),
    ).toBe(false);
    expect(
      wouldLeaveActiveProductWithoutActiveVariant({
        ...lastActiveOfActiveProduct,
        productStatus: 'DRAFT',
        targetStatus: 'ARCHIVED',
      }),
    ).toBe(false);
    expect(
      wouldLeaveActiveProductWithoutActiveVariant({
        ...lastActiveOfActiveProduct,
        variantStatus: 'INACTIVE',
        targetStatus: 'ARCHIVED',
      }),
    ).toBe(false);
  });
});

describe('activationProblems', () => {
  it('needs an active variant and valid attributes', () => {
    expect(activationProblems({ activeVariantCount: 1, attributeProblems: [] })).toEqual([]);
    expect(
      activationProblems({ activeVariantCount: 0, attributeProblems: ['attributes.fabric: x'] }),
    ).toEqual(['Add at least one active variant', 'attributes.fabric: x']);
  });
});
