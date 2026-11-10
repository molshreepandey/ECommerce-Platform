import { z } from 'zod';

import type { Prisma } from '@/generated/prisma/client';
import type { ProductStatus } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

export const productSummarySelect = {
  id: true,
  productTypeId: true,
  brandId: true,
  categoryId: true,
  taggingStatus: true,
  productGroupId: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  attributes: true,
  taxRateBasisPoints: true,
  version: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ProductSelect;

export type ProductSummary = Prisma.ProductGetPayload<{ select: typeof productSummarySelect }>;

export const variantSelect = {
  id: true,
  productId: true,
  sku: true,
  optionValues: true,
  optionSignature: true,
  mrpPaise: true,
  pricePaise: true,
  weightGrams: true,
  lengthMm: true,
  breadthMm: true,
  heightMm: true,
  status: true,
} as const satisfies Prisma.ProductVariantSelect;

export type VariantRow = Prisma.ProductVariantGetPayload<{ select: typeof variantSelect }>;

export const mediaSelect = {
  id: true,
  productId: true,
  variantId: true,
  url: true,
  altText: true,
  position: true,
} as const satisfies Prisma.ProductMediaSelect;

export type MediaRow = Prisma.ProductMediaGetPayload<{ select: typeof mediaSelect }>;

const productDetailSelect = {
  ...productSummarySelect,
  productType: { select: { id: true, code: true, name: true } },
  brand: { select: { id: true, name: true, slug: true } },
  variants: { select: variantSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  media: { select: mediaSelect, orderBy: { position: 'asc' } },
} as const satisfies Prisma.ProductSelect;

export type ProductDetail = Prisma.ProductGetPayload<{ select: typeof productDetailSelect }>;

export function findProductDetail(
  database: DatabaseClient,
  productId: string,
): Promise<ProductDetail | null> {
  return database.product.findUnique({ where: { id: productId }, select: productDetailSelect });
}

export function findProductSummary(
  database: DatabaseClient,
  productId: string,
): Promise<ProductSummary | null> {
  return database.product.findUnique({ where: { id: productId }, select: productSummarySelect });
}

const productStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
const lockedProductRowsSchema = z.array(
  z.object({
    status: productStatusSchema,
    version: z.number(),
    product_type_id: z.string(),
    slug: z.string(),
  }),
);

export interface LockedProduct {
  status: ProductStatus;
  version: number;
  productTypeId: string;
  slug: string;
}

// Every write that can affect "an ACTIVE product has an active variant" takes this lock first.
export async function lockProduct(
  database: DatabaseClient,
  productId: string,
): Promise<LockedProduct | null> {
  const rows = lockedProductRowsSchema.parse(
    await database.$queryRaw`
      SELECT status::text AS status, version, product_type_id::text AS product_type_id, slug
      FROM products WHERE id = ${productId}::uuid FOR UPDATE`,
  );
  const row = rows[0];
  return row === undefined
    ? null
    : {
        status: row.status,
        version: row.version,
        productTypeId: row.product_type_id,
        slug: row.slug,
      };
}

export function insertProduct(
  database: DatabaseClient,
  data: {
    productTypeId: string;
    brandId: string;
    name: string;
    slug: string;
    description: string;
    attributes: Prisma.InputJsonObject;
    taxRateBasisPoints: number;
  },
): Promise<ProductSummary> {
  return database.product.create({ data, select: productSummarySelect });
}

export type ProductChanges = Partial<{
  name: string;
  slug: string;
  description: string;
  brandId: string;
  attributes: Prisma.InputJsonObject;
  taxRateBasisPoints: number;
  status: ProductStatus;
  archivedAt: Date | null;
}>;

// Optimistic locking: zero rows back means the version moved on (or the product does not exist).
export async function updateProductIfVersion(
  database: DatabaseClient,
  input: { productId: string; expectedVersion: number; changes: ProductChanges },
): Promise<ProductSummary | null> {
  const rows = await database.product.updateManyAndReturn({
    where: { id: input.productId, version: input.expectedVersion },
    data: { ...input.changes, version: { increment: 1 } },
    select: productSummarySelect,
  });
  return rows[0] ?? null;
}

// Variant and image changes are part of the product aggregate, so they move its version too.
export async function bumpProductVersion(
  database: DatabaseClient,
  productId: string,
): Promise<number> {
  const updated = await database.product.update({
    where: { id: productId },
    data: { version: { increment: 1 } },
    select: { version: true },
  });
  return updated.version;
}

export function countActiveVariants(database: DatabaseClient, productId: string): Promise<number> {
  return database.productVariant.count({ where: { productId, status: 'ACTIVE' } });
}

export const productListItemSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  taggingStatus: true,
  categoryId: true,
  productGroupId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  productType: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  media: { select: { url: true, altText: true }, orderBy: { position: 'asc' }, take: 1 },
  _count: { select: { variants: true } },
} as const satisfies Prisma.ProductSelect;

export type ProductListItem = Prisma.ProductGetPayload<{ select: typeof productListItemSelect }>;

export interface ProductListQuery {
  where: Prisma.ProductWhereInput;
  orderBy: Prisma.ProductOrderByWithRelationInput[];
  take: number;
}

export async function listProductRows(
  database: DatabaseClient,
  query: ProductListQuery & { countWhere: Prisma.ProductWhereInput },
): Promise<{ items: ProductListItem[]; totalCount: number }> {
  const [items, totalCount] = await Promise.all([
    database.product.findMany({
      where: query.where,
      orderBy: query.orderBy,
      take: query.take,
      select: productListItemSelect,
    }),
    database.product.count({ where: query.countWhere }),
  ]);
  return { items, totalCount };
}
