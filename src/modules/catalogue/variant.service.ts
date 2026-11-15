import { getDatabase, isUniqueViolation, uniqueViolationConstraintName } from '@/lib/db';
import type { DatabaseClient } from '@/lib/db';
import type { AuditData } from '@/modules/audit/audit.types';
import { assertStaffPermission } from '@/modules/identity/access-control';
import { enqueueProductReindex } from '@/modules/search/search-outbox.repository';

import {
  type AttributeRule,
  type FieldErrors,
  optionSignature,
  validateVariantOptions,
} from './attribute-validation';
import { type CatalogueActor, jsonText, recordCatalogueEvent } from './catalogue-audit';
import {
  CatalogueNotFoundError,
  CatalogueValidationError,
  catalogueConflicts,
  catalogueUnprocessable,
} from './catalogue.errors';
import {
  type ChangeVariantStatusInput,
  type CreateVariantInput,
  type GenerateVariantsInput,
  maximumGeneratedVariants,
  type UpdateVariantInput,
} from './catalogue.schema';
import {
  canChangeVariantStatus,
  wouldLeaveActiveProductWithoutActiveVariant,
} from './product-lifecycle';
import { lockUnarchivedProduct, rulesUnderTypeLock } from './product.service';
import {
  bumpProductVersion,
  countActiveVariants,
  type LockedProduct,
  type VariantRow,
} from './product.repository';
import { combinationCount, generatedSku, optionCombinations } from './variant-generation';
import {
  findVariant,
  insertVariant,
  insertVariants,
  listOptionSignatures,
  updateVariantRow,
  type VariantWrite,
} from './variant.repository';

export interface VariantChangeResult {
  variant: VariantRow;
  productVersion: number;
}

function variantAuditData(variant: VariantRow): AuditData {
  return {
    productId: variant.productId,
    sku: variant.sku,
    optionValues: jsonText(variant.optionValues),
    optionSignature: variant.optionSignature,
    mrpPaise: variant.mrpPaise,
    pricePaise: variant.pricePaise,
    weightGrams: variant.weightGrams,
    lengthMm: variant.lengthMm,
    breadthMm: variant.breadthMm,
    heightMm: variant.heightMm,
    status: variant.status,
  };
}

export function rethrowVariantConflict(
  error: unknown,
  input: { sku?: string; optionSignature?: string },
): never {
  if (isUniqueViolation(error)) {
    const constraintName = uniqueViolationConstraintName(error);
    if (constraintName === 'product_variants_sku_key') {
      throw catalogueConflicts.skuTaken(input.sku);
    }
    if (constraintName === 'product_variants_product_id_option_signature_key') {
      throw catalogueConflicts.duplicateVariantCombination(input.optionSignature ?? '');
    }
  }
  throw error;
}

function validOptions(rules: readonly AttributeRule[], optionValues: unknown) {
  const result = validateVariantOptions(rules, optionValues);
  if (!result.success) throw new CatalogueValidationError(result.fieldErrors);
  return result.values;
}

// Under the product lock: a variant belongs to an unarchived product and is re-read after locking.
async function lockVariantForChange(
  transaction: DatabaseClient,
  variantId: string,
): Promise<{ locked: LockedProduct; variant: VariantRow }> {
  const unlocked = await findVariant(transaction, variantId);
  if (unlocked === null) throw new CatalogueNotFoundError('VARIANT');
  const locked = await lockUnarchivedProduct(transaction, unlocked.productId);
  const variant = await findVariant(transaction, variantId);
  if (variant === null) throw new CatalogueNotFoundError('VARIANT');
  return { locked, variant };
}

async function finishVariantChange(
  transaction: DatabaseClient,
  actor: CatalogueActor,
  event: Parameters<typeof recordCatalogueEvent>[2] & { productId: string },
): Promise<number> {
  const productVersion = await bumpProductVersion(transaction, event.productId);
  await recordCatalogueEvent(transaction, actor, event);
  await enqueueProductReindex(transaction, event.productId);
  return productVersion;
}

// The variant insert under the product lock, with validation, audit, version bump and search update,
// inside the caller's transaction (shared by the variant form and the bulk CSV import, D16). Reports
// the option signature it computed so the caller can name a duplicate combination.
export async function createVariantInTransaction(
  transaction: DatabaseClient,
  actor: CatalogueActor,
  productId: string,
  input: CreateVariantInput,
  onSignature: (signature: string) => void = () => undefined,
): Promise<VariantChangeResult> {
  const locked = await lockUnarchivedProduct(transaction, productId);
  const rules = await rulesUnderTypeLock(transaction, locked.productTypeId);
  const optionValues = validOptions(rules, input.optionValues);
  const signature = optionSignature(optionValues);
  onSignature(signature);
  const variant = await insertVariant(transaction, productId, {
    sku: input.sku,
    optionValues,
    optionSignature: signature,
    mrpPaise: input.mrpPaise,
    pricePaise: input.pricePaise,
    weightGrams: input.weightGrams,
    lengthMm: input.lengthMm,
    breadthMm: input.breadthMm,
    heightMm: input.heightMm,
  });
  const productVersion = await finishVariantChange(transaction, actor, {
    productId,
    action: 'catalogue.variant_created',
    entityType: 'product_variant',
    entityId: variant.id,
    after: variantAuditData(variant),
  });
  return { variant, productVersion };
}

export async function createVariant(
  actor: CatalogueActor,
  productId: string,
  input: CreateVariantInput,
): Promise<VariantChangeResult> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  let signature: string | undefined;
  try {
    return await getDatabase().$transaction((transaction) =>
      createVariantInTransaction(transaction, actor, productId, input, (computed) => {
        signature = computed;
      }),
    );
  } catch (error) {
    rethrowVariantConflict(error, {
      sku: input.sku,
      ...(signature === undefined ? {} : { optionSignature: signature }),
    });
  }
}

function plannedVariants(
  rules: readonly AttributeRule[],
  input: GenerateVariantsInput,
  takenSignatures: ReadonlySet<string>,
): { writes: VariantWrite[]; skippedOptionSignatures: string[] } {
  if (combinationCount(input.options) > maximumGeneratedVariants) {
    throw new CatalogueValidationError({
      options: [`Choose fewer values: at most ${maximumGeneratedVariants} variants at a time`],
    });
  }
  const writes: VariantWrite[] = [];
  const skippedOptionSignatures: string[] = [];
  for (const combination of optionCombinations(input.options)) {
    const optionValues = validOptions(rules, combination);
    const signature = optionSignature(optionValues);
    if (takenSignatures.has(signature)) {
      skippedOptionSignatures.push(signature);
      continue;
    }
    const sku = generatedSku(input.skuPrefix, optionValues);
    if (sku === null) {
      throw new CatalogueValidationError({
        skuPrefix: ['Use a shorter prefix: a generated SKU is too long'],
      });
    }
    writes.push({ sku, optionValues, optionSignature: signature, ...measurementsOf(input) });
  }
  const skus = writes.map(({ sku }) => sku);
  if (new Set(skus).size !== skus.length) {
    throw new CatalogueValidationError({ options: ['Two combinations would get the same SKU'] });
  }
  return { writes, skippedOptionSignatures };
}

function measurementsOf(input: GenerateVariantsInput) {
  return {
    mrpPaise: input.mrpPaise,
    pricePaise: input.pricePaise,
    weightGrams: input.weightGrams,
    lengthMm: input.lengthMm,
    breadthMm: input.breadthMm,
    heightMm: input.heightMm,
  };
}

// Size × colour generator: existing combinations (archived ones too) are skipped, never duplicated.
export async function generateVariants(
  actor: CatalogueActor,
  productId: string,
  input: GenerateVariantsInput,
): Promise<{ created: VariantRow[]; skippedOptionSignatures: string[]; productVersion: number }> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  try {
    return await getDatabase().$transaction(async (transaction) => {
      const locked = await lockUnarchivedProduct(transaction, productId);
      const rules = await rulesUnderTypeLock(transaction, locked.productTypeId);
      const takenSignatures = await listOptionSignatures(transaction, productId);
      const { writes, skippedOptionSignatures } = plannedVariants(rules, input, takenSignatures);
      if (writes.length === 0) {
        return { created: [], skippedOptionSignatures, productVersion: locked.version };
      }
      const created = await insertVariants(transaction, productId, writes);
      const productVersion = await finishVariantChange(transaction, actor, {
        productId,
        action: 'catalogue.variants_generated',
        entityType: 'product',
        entityId: productId,
        after: {
          createdCount: created.length,
          skippedCount: skippedOptionSignatures.length,
          skus: jsonText(created.map(({ sku }) => sku)),
        },
      });
      return { created, skippedOptionSignatures, productVersion };
    });
  } catch (error) {
    rethrowVariantConflict(error, {});
  }
}

function priceErrors(variant: VariantRow, input: UpdateVariantInput): FieldErrors | null {
  const mrpPaise = input.mrpPaise ?? variant.mrpPaise;
  const pricePaise = input.pricePaise ?? variant.pricePaise;
  return pricePaise > mrpPaise ? { pricePaise: ['The price cannot be higher than the MRP'] } : null;
}

export async function updateVariant(
  actor: CatalogueActor,
  variantId: string,
  input: UpdateVariantInput,
): Promise<VariantChangeResult> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  return await getDatabase().$transaction(async (transaction) => {
    const { variant: before } = await lockVariantForChange(transaction, variantId);
    if (before.status === 'ARCHIVED') throw catalogueConflicts.variantArchived();
    const errors = priceErrors(before, input);
    if (errors !== null) throw new CatalogueValidationError(errors);
    const after = await updateVariantRow(transaction, variantId, {
      ...(input.mrpPaise === undefined ? {} : { mrpPaise: input.mrpPaise }),
      ...(input.pricePaise === undefined ? {} : { pricePaise: input.pricePaise }),
      ...(input.weightGrams === undefined ? {} : { weightGrams: input.weightGrams }),
      ...(input.lengthMm === undefined ? {} : { lengthMm: input.lengthMm }),
      ...(input.breadthMm === undefined ? {} : { breadthMm: input.breadthMm }),
      ...(input.heightMm === undefined ? {} : { heightMm: input.heightMm }),
    });
    const productVersion = await finishVariantChange(transaction, actor, {
      productId: before.productId,
      action: 'catalogue.variant_updated',
      entityType: 'product_variant',
      entityId: variantId,
      before: variantAuditData(before),
      after: variantAuditData(after),
    });
    return { variant: after, productVersion };
  });
}

// Status only: stock levels, reservations, movements, order lines and carts are never touched.
export async function changeVariantStatus(
  actor: CatalogueActor,
  variantId: string,
  input: ChangeVariantStatusInput,
): Promise<VariantChangeResult> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  return await getDatabase().$transaction(async (transaction) => {
    const { locked, variant } = await lockVariantForChange(transaction, variantId);
    if (!canChangeVariantStatus(variant.status, input.status)) {
      throw catalogueConflicts.invalidStatusTransition(variant.status, input.status);
    }
    const activeVariantCount = await countActiveVariants(transaction, variant.productId);
    if (
      wouldLeaveActiveProductWithoutActiveVariant({
        productStatus: locked.status,
        variantStatus: variant.status,
        targetStatus: input.status,
        activeVariantCount,
      })
    ) {
      throw catalogueConflicts.lastActiveVariant();
    }
    if (variant.status === 'ARCHIVED') {
      const rules = await rulesUnderTypeLock(transaction, locked.productTypeId);
      const result = validateVariantOptions(rules, variant.optionValues);
      if (!result.success) throw catalogueUnprocessable.variantOptionsOutdated(result.fieldErrors);
    }
    const after = await updateVariantRow(transaction, variantId, { status: input.status });
    const productVersion = await finishVariantChange(transaction, actor, {
      productId: variant.productId,
      action: 'catalogue.variant_status_changed',
      entityType: 'product_variant',
      entityId: variantId,
      before: { status: variant.status, sku: variant.sku },
      after: { status: after.status, sku: after.sku },
    });
    return { variant: after, productVersion };
  });
}
