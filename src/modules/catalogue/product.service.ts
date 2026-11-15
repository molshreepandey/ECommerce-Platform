import type { Prisma } from '@/generated/prisma/client';
import { getDatabase, isUniqueViolation, uniqueViolationConstraintName } from '@/lib/db';
import type { DatabaseClient } from '@/lib/db';
import type { AuditData } from '@/modules/audit/audit.types';
import { assertStaffPermission, type StaffContext } from '@/modules/identity/access-control';
import { enqueueProductReindex } from '@/modules/search/search-outbox.repository';

import { z } from 'zod';

import {
  attributeProblemsForActivation,
  type AttributeRule,
  validateProductAttributes,
} from './attribute-validation';
import { lockBrand } from './brand.repository';
import { type CatalogueActor, jsonText, recordCatalogueEvent } from './catalogue-audit';
import {
  CatalogueNotFoundError,
  CatalogueValidationError,
  catalogueConflicts,
  catalogueUnprocessable,
} from './catalogue.errors';
import type {
  ChangeProductStatusInput,
  CreateProductInput,
  ListProductsInput,
  UpdateProductInput,
} from './catalogue.schema';
import { activationProblems, canChangeProductStatus } from './product-lifecycle';
import { buildProductListQuery, nextCursorFor } from './product-list-query';
import {
  listActiveAttributeRules,
  lockProductTypeForProductWrite,
} from './product-type.repository';
import {
  findProductDetail,
  findProductSummary,
  insertProduct,
  listProductRows,
  type LockedProduct,
  lockProduct,
  type ProductChanges,
  type ProductDetail,
  type ProductListItem,
  type ProductSummary,
  countActiveVariants,
  updateProductIfVersion,
} from './product.repository';
import { slugFromName } from './slug';

export function rethrowProductConflict(error: unknown): never {
  if (isUniqueViolation(error) && uniqueViolationConstraintName(error) === 'products_slug_key') {
    throw catalogueConflicts.productSlugTaken();
  }
  throw error;
}

export function productAuditData(product: ProductSummary): AuditData {
  return {
    name: product.name,
    slug: product.slug,
    brandId: product.brandId,
    productTypeId: product.productTypeId,
    status: product.status,
    description: product.description,
    attributes: jsonText(product.attributes),
    taxRateBasisPoints: product.taxRateBasisPoints,
    version: product.version,
  };
}

async function assertActiveBrand(transaction: DatabaseClient, brandId: string): Promise<void> {
  const brand = await lockBrand(transaction, brandId);
  if (brand === null) throw new CatalogueNotFoundError('BRAND');
  if (!brand.isActive) throw catalogueUnprocessable.brandInactive();
}

// The type's share lock keeps its definitions still while a product or variant is validated.
export async function rulesUnderTypeLock(
  transaction: DatabaseClient,
  productTypeId: string,
): Promise<AttributeRule[]> {
  const lockedType = await lockProductTypeForProductWrite(transaction, productTypeId);
  if (lockedType === null) throw new CatalogueNotFoundError('PRODUCT_TYPE');
  if (lockedType.archivedAt !== null) throw catalogueConflicts.productTypeArchived();
  return listActiveAttributeRules(transaction, productTypeId);
}

async function validatedAttributes(
  transaction: DatabaseClient,
  productTypeId: string,
  attributes: unknown,
): Promise<Prisma.InputJsonObject> {
  const rules = await rulesUnderTypeLock(transaction, productTypeId);
  const result = validateProductAttributes(rules, attributes);
  if (!result.success) throw new CatalogueValidationError(result.fieldErrors);
  return result.values;
}

// Variant and image writes: lock the product row and refuse archived products.
export async function lockUnarchivedProduct(
  transaction: DatabaseClient,
  productId: string,
): Promise<LockedProduct> {
  const locked = await lockProduct(transaction, productId);
  if (locked === null) throw new CatalogueNotFoundError('PRODUCT');
  if (locked.status === 'ARCHIVED') throw catalogueConflicts.productArchived();
  return locked;
}

// Shared by every product-level write: the row lock, the archived check and the version check.
export async function lockProductForEdit(
  transaction: DatabaseClient,
  input: { productId: string; expectedVersion: number },
): Promise<LockedProduct> {
  const locked = await lockProduct(transaction, input.productId);
  if (locked === null) throw new CatalogueNotFoundError('PRODUCT');
  if (locked.version !== input.expectedVersion) throw catalogueConflicts.staleProduct();
  return locked;
}

export async function getProduct(staff: StaffContext, productId: string): Promise<ProductDetail> {
  assertStaffPermission(staff, 'catalogue.read');
  const product = await findProductDetail(getDatabase(), productId);
  if (product === null) throw new CatalogueNotFoundError('PRODUCT');
  return product;
}

export async function listProducts(
  staff: StaffContext,
  input: ListProductsInput,
): Promise<{ items: ProductListItem[]; totalCount: number; nextCursor: string | null }> {
  assertStaffPermission(staff, 'catalogue.read');
  const query = buildProductListQuery(input);
  const { items, totalCount } = await listProductRows(getDatabase(), query);
  const pageItems = items.slice(0, input.limit);
  const lastItem = pageItems.at(-1);
  const hasMore = items.length > input.limit;
  return {
    items: pageItems,
    totalCount,
    nextCursor: hasMore && lastItem !== undefined ? nextCursorFor(input.sort, lastItem) : null,
  };
}

// The product insert with its validation, audit row and search update, inside the caller's transaction
// (shared by the create form and the bulk CSV import, D16). `slug` is already resolved.
export async function createProductInTransaction(
  transaction: DatabaseClient,
  actor: CatalogueActor,
  input: CreateProductInput & { slug: string },
): Promise<ProductSummary> {
  const attributes = await validatedAttributes(transaction, input.productTypeId, input.attributes);
  await assertActiveBrand(transaction, input.brandId);
  const product = await insertProduct(transaction, {
    productTypeId: input.productTypeId,
    brandId: input.brandId,
    name: input.name,
    slug: input.slug,
    description: input.description,
    attributes,
    taxRateBasisPoints: input.taxRateBasisPoints,
  });
  await recordCatalogueEvent(transaction, actor, {
    action: 'catalogue.product_created',
    entityType: 'product',
    entityId: product.id,
    after: productAuditData(product),
  });
  await enqueueProductReindex(transaction, product.id);
  return product;
}

export async function createProduct(
  actor: CatalogueActor,
  input: CreateProductInput,
): Promise<ProductSummary> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  const slug = input.slug ?? slugFromName(input.name);
  if (slug === '') throw new CatalogueValidationError({ slug: ['Enter a slug'] });
  try {
    return await getDatabase().$transaction((transaction) =>
      createProductInTransaction(transaction, actor, { ...input, slug }),
    );
  } catch (error) {
    rethrowProductConflict(error);
  }
}

async function productChanges(
  transaction: DatabaseClient,
  locked: LockedProduct,
  input: UpdateProductInput,
): Promise<ProductChanges> {
  if (input.slug !== undefined && input.slug !== locked.slug && locked.status !== 'DRAFT') {
    throw catalogueConflicts.slugLocked();
  }
  if (input.brandId !== undefined) await assertActiveBrand(transaction, input.brandId);
  const attributes =
    input.attributes === undefined
      ? undefined
      : await validatedAttributes(transaction, locked.productTypeId, input.attributes);
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.slug === undefined ? {} : { slug: input.slug }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.brandId === undefined ? {} : { brandId: input.brandId }),
    ...(attributes === undefined ? {} : { attributes }),
    ...(input.taxRateBasisPoints === undefined
      ? {}
      : { taxRateBasisPoints: input.taxRateBasisPoints }),
  };
}

export async function updateProduct(
  actor: CatalogueActor,
  productId: string,
  input: UpdateProductInput,
): Promise<ProductSummary> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  try {
    return await getDatabase().$transaction(async (transaction) => {
      const locked = await lockProductForEdit(transaction, {
        productId,
        expectedVersion: input.expectedVersion,
      });
      if (locked.status === 'ARCHIVED') throw catalogueConflicts.productArchived();
      const before = await findProductSummary(transaction, productId);
      if (before === null) throw new CatalogueNotFoundError('PRODUCT');
      const changes = await productChanges(transaction, locked, input);
      const after = await updateProductIfVersion(transaction, {
        productId,
        expectedVersion: input.expectedVersion,
        changes,
      });
      if (after === null) throw catalogueConflicts.staleProduct();
      await recordCatalogueEvent(transaction, actor, {
        action: 'catalogue.product_updated',
        entityType: 'product',
        entityId: productId,
        before: productAuditData(before),
        after: productAuditData(after),
      });
      await enqueueProductReindex(transaction, productId);
      return after;
    });
  } catch (error) {
    rethrowProductConflict(error);
  }
}

const storedAttributesSchema = z.record(z.string(), z.unknown());

// Checked under the product lock, which variant status changes also take, so the answer cannot go
// stale before the status is written.
async function activationReasons(
  transaction: DatabaseClient,
  productId: string,
  locked: LockedProduct,
): Promise<string[]> {
  const product = await findProductSummary(transaction, productId);
  if (product === null) throw new CatalogueNotFoundError('PRODUCT');
  const rules = await rulesUnderTypeLock(transaction, locked.productTypeId);
  const brand = await lockBrand(transaction, product.brandId);
  const reasons = activationProblems({
    activeVariantCount: await countActiveVariants(transaction, productId),
    attributeProblems: attributeProblemsForActivation(
      rules,
      storedAttributesSchema.parse(product.attributes),
    ),
  });
  return brand?.isActive === true ? reasons : [...reasons, 'The brand is inactive'];
}

// DRAFT → ACTIVE needs an active variant (422); archiving changes the status and nothing else, so
// stock, reservations, movements, order lines, carts, reviews and collection links are untouched.
export async function changeProductStatus(
  actor: CatalogueActor,
  productId: string,
  input: ChangeProductStatusInput,
): Promise<ProductSummary> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  return await getDatabase().$transaction(async (transaction) => {
    const locked = await lockProductForEdit(transaction, {
      productId,
      expectedVersion: input.expectedVersion,
    });
    if (!canChangeProductStatus(locked.status, input.status)) {
      throw catalogueConflicts.invalidStatusTransition(locked.status, input.status);
    }
    if (input.status === 'ACTIVE') {
      const reasons = await activationReasons(transaction, productId, locked);
      if (reasons.length > 0) throw catalogueUnprocessable.productNotReady(reasons);
    }
    if (locked.status === 'ARCHIVED') await rulesUnderTypeLock(transaction, locked.productTypeId);
    const after = await updateProductIfVersion(transaction, {
      productId,
      expectedVersion: input.expectedVersion,
      changes: {
        status: input.status,
        archivedAt: input.status === 'ARCHIVED' ? new Date() : null,
      },
    });
    if (after === null) throw catalogueConflicts.staleProduct();
    await recordCatalogueEvent(transaction, actor, {
      action: 'catalogue.product_status_changed',
      entityType: 'product',
      entityId: productId,
      before: { status: locked.status, version: locked.version },
      after: { status: after.status, version: after.version },
    });
    await enqueueProductReindex(transaction, productId);
    return after;
  });
}
