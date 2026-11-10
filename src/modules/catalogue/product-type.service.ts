import { getDatabase, isUniqueViolation, uniqueViolationConstraintName } from '@/lib/db';
import type { DatabaseClient } from '@/lib/db';
import { assertStaffPermission, type StaffContext } from '@/modules/identity/access-control';
import { enqueueProductsOfType } from '@/modules/search/search-outbox.repository';

import { type CatalogueActor, jsonText, recordCatalogueEvent } from './catalogue-audit';
import {
  CatalogueNotFoundError,
  CatalogueValidationError,
  catalogueConflicts,
} from './catalogue.errors';
import type {
  CreateAttributeDefinitionInput,
  CreateProductTypeInput,
  UpdateAttributeDefinitionInput,
  UpdateProductTypeInput,
} from './catalogue.schema';
import {
  type AttributeDefinitionRow,
  countProductsMissingAttribute,
  countUnarchivedProductsOfType,
  countVariantsMissingOption,
  countVariantsUsingOption,
  findAllowedValuesInUse,
  findAttributeDefinition,
  findProductType,
  insertAttributeDefinition,
  insertProductType,
  listActiveDefinitionsForTypes,
  listAttributeDefinitions,
  listProductTypes,
  lockProductTypeForDefinitionChange,
  type ProductTypeRow,
  updateAttributeDefinitionRow,
  updateProductTypeRow,
} from './product-type.repository';

export interface ProductTypeDetail extends ProductTypeRow {
  attributeDefinitions: AttributeDefinitionRow[];
}

function rethrowUnique(error: unknown, constraintErrors: Record<string, () => Error>): never {
  if (isUniqueViolation(error)) {
    const toConflict = constraintErrors[uniqueViolationConstraintName(error) ?? ''];
    if (toConflict !== undefined) throw toConflict();
  }
  throw error;
}

async function lockTypeForChange(transaction: DatabaseClient, productTypeId: string) {
  const locked = await lockProductTypeForDefinitionChange(transaction, productTypeId);
  if (locked === null) throw new CatalogueNotFoundError('PRODUCT_TYPE');
  return locked;
}

function definitionAuditData(definition: AttributeDefinitionRow) {
  return {
    code: definition.code,
    label: definition.label,
    dataType: definition.dataType,
    scope: definition.scope,
    isRequired: definition.isRequired,
    isFilterable: definition.isFilterable,
    isSearchable: definition.isSearchable,
    allowedValues: jsonText(definition.allowedValues),
    displayOrder: definition.displayOrder,
  };
}

export async function listAllProductTypes(staff: StaffContext): Promise<ProductTypeRow[]> {
  assertStaffPermission(staff, 'catalogue.read');
  return await listProductTypes(getDatabase());
}

// Unarchived types with their active definitions, for the "new product" form: two queries in total.
export async function listProductTypesWithDefinitions(
  staff: StaffContext,
): Promise<ProductTypeDetail[]> {
  assertStaffPermission(staff, 'catalogue.read');
  const database = getDatabase();
  const productTypes = (await listProductTypes(database)).filter(
    ({ archivedAt }) => archivedAt === null,
  );
  const definitions = await listActiveDefinitionsForTypes(
    database,
    productTypes.map(({ id }) => id),
  );
  return productTypes.map((productType) => ({
    ...productType,
    attributeDefinitions: definitions.filter(
      ({ productTypeId }) => productTypeId === productType.id,
    ),
  }));
}

export async function getProductType(
  staff: StaffContext,
  productTypeId: string,
): Promise<ProductTypeDetail> {
  assertStaffPermission(staff, 'catalogue.read');
  const database = getDatabase();
  const productType = await findProductType(database, productTypeId);
  if (productType === null) throw new CatalogueNotFoundError('PRODUCT_TYPE');
  return {
    ...productType,
    attributeDefinitions: await listAttributeDefinitions(database, productTypeId),
  };
}

export async function createProductType(
  actor: CatalogueActor,
  input: CreateProductTypeInput,
): Promise<ProductTypeRow> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  try {
    return await getDatabase().$transaction(async (transaction) => {
      const productType = await insertProductType(transaction, {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
      });
      await recordCatalogueEvent(transaction, actor, {
        action: 'catalogue.product_type_created',
        entityType: 'product_type',
        entityId: productType.id,
        after: { code: productType.code, name: productType.name },
      });
      return productType;
    });
  } catch (error) {
    rethrowUnique(error, { product_types_code_key: catalogueConflicts.productTypeCodeTaken });
  }
}

export async function updateProductType(
  actor: CatalogueActor,
  productTypeId: string,
  input: UpdateProductTypeInput,
): Promise<ProductTypeRow> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  return await getDatabase().$transaction(async (transaction) => {
    const locked = await lockTypeForChange(transaction, productTypeId);
    if (locked.archivedAt !== null) throw catalogueConflicts.productTypeArchived();
    const before = await findProductType(transaction, productTypeId);
    const after = await updateProductTypeRow(transaction, productTypeId, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
    });
    await recordCatalogueEvent(transaction, actor, {
      action: 'catalogue.product_type_updated',
      entityType: 'product_type',
      entityId: productTypeId,
      before: { name: before?.name ?? null, description: before?.description ?? null },
      after: { name: after.name, description: after.description },
    });
    if (input.name !== undefined) await enqueueProductsOfType(transaction, productTypeId);
    return after;
  });
}

export async function archiveProductType(
  actor: CatalogueActor,
  productTypeId: string,
): Promise<ProductTypeRow> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  return await getDatabase().$transaction(async (transaction) => {
    const locked = await lockTypeForChange(transaction, productTypeId);
    if (locked.archivedAt !== null) throw catalogueConflicts.productTypeArchived();
    const productCount = await countUnarchivedProductsOfType(transaction, productTypeId);
    if (productCount > 0) throw catalogueConflicts.productTypeInUse(productCount);
    const archived = await updateProductTypeRow(transaction, productTypeId, {
      archivedAt: new Date(),
    });
    await recordCatalogueEvent(transaction, actor, {
      action: 'catalogue.product_type_archived',
      entityType: 'product_type',
      entityId: productTypeId,
      after: { code: archived.code },
    });
    return archived;
  });
}

export async function restoreProductType(
  actor: CatalogueActor,
  productTypeId: string,
): Promise<ProductTypeRow> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  return await getDatabase().$transaction(async (transaction) => {
    const locked = await lockTypeForChange(transaction, productTypeId);
    if (locked.archivedAt === null) throw catalogueConflicts.productTypeNotArchived();
    const restored = await updateProductTypeRow(transaction, productTypeId, { archivedAt: null });
    await recordCatalogueEvent(transaction, actor, {
      action: 'catalogue.product_type_restored',
      entityType: 'product_type',
      entityId: productTypeId,
      after: { code: restored.code },
    });
    return restored;
  });
}

async function countMissingValues(
  transaction: DatabaseClient,
  definition: Pick<AttributeDefinitionRow, 'productTypeId' | 'code' | 'scope'>,
): Promise<number> {
  const target = { productTypeId: definition.productTypeId, code: definition.code };
  return definition.scope === 'PRODUCT'
    ? countProductsMissingAttribute(transaction, target)
    : countVariantsMissingOption(transaction, target);
}

export async function createAttributeDefinition(
  actor: CatalogueActor,
  productTypeId: string,
  input: CreateAttributeDefinitionInput,
): Promise<AttributeDefinitionRow> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  try {
    return await getDatabase().$transaction(async (transaction) => {
      const locked = await lockTypeForChange(transaction, productTypeId);
      if (locked.archivedAt !== null) throw catalogueConflicts.productTypeArchived();
      if (input.isRequired) {
        const missingCount = await countMissingValues(transaction, { productTypeId, ...input });
        if (missingCount > 0) throw catalogueConflicts.attributeRequiredButMissing(missingCount);
      }
      const definition = await insertAttributeDefinition(transaction, {
        productTypeId,
        code: input.code,
        label: input.label,
        dataType: input.dataType,
        scope: input.scope,
        isRequired: input.isRequired,
        isFilterable: input.isFilterable,
        isSearchable: input.isSearchable,
        allowedValues: input.allowedValues ?? null,
        displayOrder: input.displayOrder,
      });
      await recordCatalogueEvent(transaction, actor, {
        action: 'catalogue.attribute_definition_created',
        entityType: 'attribute_definition',
        entityId: definition.id,
        after: { productTypeId, ...definitionAuditData(definition) },
      });
      await enqueueProductsOfType(transaction, productTypeId);
      return definition;
    });
  } catch (error) {
    rethrowUnique(error, {
      attribute_definitions_product_type_id_code_key: catalogueConflicts.attributeCodeTaken,
    });
  }
}

async function assertDefinitionChangeAllowed(
  transaction: DatabaseClient,
  existing: AttributeDefinitionRow,
  input: UpdateAttributeDefinitionInput,
): Promise<void> {
  if (input.allowedValues !== undefined) {
    if (existing.allowedValues === null) {
      throw new CatalogueValidationError({
        allowedValues: ['Only choice attributes have allowed values'],
      });
    }
    const removedValues = existing.allowedValues.filter(
      (value) => !input.allowedValues?.includes(value),
    );
    const valuesInUse = await findAllowedValuesInUse(transaction, {
      productTypeId: existing.productTypeId,
      code: existing.code,
      dataType: existing.dataType,
      scope: existing.scope,
      values: removedValues,
    });
    if (valuesInUse.length > 0) throw catalogueConflicts.attributeValueInUse(valuesInUse);
  }
  if (input.isRequired === true && !existing.isRequired) {
    const missingCount = await countMissingValues(transaction, existing);
    if (missingCount > 0) throw catalogueConflicts.attributeRequiredButMissing(missingCount);
  }
}

async function lockDefinitionForChange(
  transaction: DatabaseClient,
  attributeDefinitionId: string,
): Promise<AttributeDefinitionRow> {
  const unlocked = await findAttributeDefinition(transaction, attributeDefinitionId);
  if (unlocked === null) throw new CatalogueNotFoundError('ATTRIBUTE_DEFINITION');
  const locked = await lockTypeForChange(transaction, unlocked.productTypeId);
  if (locked.archivedAt !== null) throw catalogueConflicts.productTypeArchived();
  // Re-read under the type lock so the checks below see the latest committed definition.
  const existing = await findAttributeDefinition(transaction, attributeDefinitionId);
  if (existing === null) throw new CatalogueNotFoundError('ATTRIBUTE_DEFINITION');
  if (existing.archivedAt !== null) throw catalogueConflicts.attributeDefinitionArchived();
  return existing;
}

export async function updateAttributeDefinition(
  actor: CatalogueActor,
  attributeDefinitionId: string,
  input: UpdateAttributeDefinitionInput,
): Promise<AttributeDefinitionRow> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  return await getDatabase().$transaction(async (transaction) => {
    const existing = await lockDefinitionForChange(transaction, attributeDefinitionId);
    await assertDefinitionChangeAllowed(transaction, existing, input);
    const updated = await updateAttributeDefinitionRow(transaction, attributeDefinitionId, {
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.isRequired === undefined ? {} : { isRequired: input.isRequired }),
      ...(input.isFilterable === undefined ? {} : { isFilterable: input.isFilterable }),
      ...(input.isSearchable === undefined ? {} : { isSearchable: input.isSearchable }),
      ...(input.allowedValues === undefined ? {} : { allowedValues: input.allowedValues }),
      ...(input.displayOrder === undefined ? {} : { displayOrder: input.displayOrder }),
    });
    await recordCatalogueEvent(transaction, actor, {
      action: 'catalogue.attribute_definition_updated',
      entityType: 'attribute_definition',
      entityId: attributeDefinitionId,
      before: definitionAuditData(existing),
      after: definitionAuditData(updated),
    });
    await enqueueProductsOfType(transaction, existing.productTypeId);
    return updated;
  });
}

export async function archiveAttributeDefinition(
  actor: CatalogueActor,
  attributeDefinitionId: string,
): Promise<AttributeDefinitionRow> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  return await getDatabase().$transaction(async (transaction) => {
    const existing = await lockDefinitionForChange(transaction, attributeDefinitionId);
    if (existing.scope === 'VARIANT_OPTION') {
      const variantCount = await countVariantsUsingOption(transaction, existing);
      if (variantCount > 0) throw catalogueConflicts.attributeInUse(variantCount);
    }
    const archived = await updateAttributeDefinitionRow(transaction, attributeDefinitionId, {
      archivedAt: new Date(),
    });
    await recordCatalogueEvent(transaction, actor, {
      action: 'catalogue.attribute_definition_archived',
      entityType: 'attribute_definition',
      entityId: attributeDefinitionId,
      before: definitionAuditData(existing),
    });
    await enqueueProductsOfType(transaction, existing.productTypeId);
    return archived;
  });
}
