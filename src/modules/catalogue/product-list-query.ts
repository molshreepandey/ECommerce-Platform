import { z } from 'zod';

import type { Prisma } from '@/generated/prisma/client';
import { sellableStockWhere } from '@/modules/inventory/stock-availability';

import { CatalogueValidationError } from './catalogue.errors';
import type { ListProductsInput } from './catalogue.schema';

const cursorSchema = z.strictObject({ sortValue: z.string().min(1), id: z.uuid() });
type ListCursor = z.infer<typeof cursorSchema>;

export function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeListCursor(encoded: string): ListCursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
  } catch {
    throw new CatalogueValidationError({ cursor: ['This page link is no longer valid'] });
  }
}

// In stock = an active variant with sellable stock as the inventory module defines it (available
// quantity in an active warehouse), so the filter and inventory availability can never disagree.
const sellableStock = {
  status: 'ACTIVE',
  inventoryLevels: { some: sellableStockWhere },
} as const satisfies Prisma.ProductVariantWhereInput;

function filterWhere(input: ListProductsInput): Prisma.ProductWhereInput {
  return {
    // Archived products stay out of the list unless asked for (Wave 3 acceptance test).
    status: input.status ?? { not: 'ARCHIVED' },
    ...(input.search === undefined
      ? {}
      : { name: { contains: input.search, mode: 'insensitive' as const } }),
    ...(input.productTypeId === undefined ? {} : { productTypeId: input.productTypeId }),
    ...(input.brandId === undefined ? {} : { brandId: input.brandId }),
    ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
    ...(input.taggingStatus === undefined ? {} : { taggingStatus: input.taggingStatus }),
    ...(input.productGroupId === undefined ? {} : { productGroupId: input.productGroupId }),
    ...(input.stock === 'IN_STOCK' ? { variants: { some: sellableStock } } : {}),
    ...(input.stock === 'OUT_OF_STOCK' ? { NOT: { variants: { some: sellableStock } } } : {}),
  };
}

// Newest/oldest use the id alone: ids come from uuidv7() at insert time, so they are unique and
// time-ordered. Comparing created_at instead would lose precision (JavaScript dates have milliseconds,
// Postgres stores microseconds) and could skip or repeat rows between pages.
function keysetWhere(
  sort: ListProductsInput['sort'],
  cursor: ListCursor,
): Prisma.ProductWhereInput {
  switch (sort) {
    case 'NEWEST':
      return { id: { lt: cursor.id } };
    case 'OLDEST':
      return { id: { gt: cursor.id } };
    case 'NAME':
      return {
        OR: [{ name: { gt: cursor.sortValue } }, { name: cursor.sortValue, id: { gt: cursor.id } }],
      };
  }
}

const orderBySort: Record<ListProductsInput['sort'], Prisma.ProductOrderByWithRelationInput[]> = {
  NEWEST: [{ id: 'desc' }],
  OLDEST: [{ id: 'asc' }],
  NAME: [{ name: 'asc' }, { id: 'asc' }],
};

export function buildProductListQuery(input: ListProductsInput) {
  const filters = filterWhere(input);
  const cursor = input.cursor === undefined ? null : decodeListCursor(input.cursor);
  return {
    countWhere: filters,
    where: cursor === null ? filters : { AND: [filters, keysetWhere(input.sort, cursor)] },
    orderBy: orderBySort[input.sort],
    // One extra row tells us whether there is a next page without a second query.
    take: input.limit + 1,
  };
}

export function nextCursorFor(
  sort: ListProductsInput['sort'],
  lastItem: { id: string; name: string },
): string {
  return encodeListCursor({
    sortValue: sort === 'NAME' ? lastItem.name : lastItem.id,
    id: lastItem.id,
  });
}
