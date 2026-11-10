import { z } from 'zod';

import type { AttributeDataType, AttributeScope } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

import type { AttributeRule } from './attribute-validation';

export const productTypeSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  archivedAt: true,
} as const;

export interface ProductTypeRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
}

const attributeDefinitionSelect = {
  id: true,
  productTypeId: true,
  code: true,
  label: true,
  dataType: true,
  scope: true,
  isRequired: true,
  isFilterable: true,
  isSearchable: true,
  allowedValues: true,
  displayOrder: true,
  archivedAt: true,
} as const;

export interface AttributeDefinitionRow {
  id: string;
  productTypeId: string;
  code: string;
  label: string;
  dataType: AttributeDataType;
  scope: AttributeScope;
  isRequired: boolean;
  isFilterable: boolean;
  isSearchable: boolean;
  allowedValues: string[] | null;
  displayOrder: number;
  archivedAt: Date | null;
}

const allowedValuesColumnSchema = z.array(z.string()).nullable();

// allowed_values is JSONB; it is parsed once here so the rest of the module sees string[] | null.
function toDefinitionRow(
  row: Omit<AttributeDefinitionRow, 'allowedValues'> & { allowedValues: unknown },
): AttributeDefinitionRow {
  return { ...row, allowedValues: allowedValuesColumnSchema.parse(row.allowedValues) };
}

export function toAttributeRule(definition: AttributeDefinitionRow): AttributeRule {
  return {
    code: definition.code,
    label: definition.label,
    dataType: definition.dataType,
    scope: definition.scope,
    isRequired: definition.isRequired,
    allowedValues: definition.allowedValues,
  };
}

export function listProductTypes(database: DatabaseClient): Promise<ProductTypeRow[]> {
  return database.productType.findMany({ select: productTypeSelect, orderBy: { name: 'asc' } });
}

export function findProductType(
  database: DatabaseClient,
  productTypeId: string,
): Promise<ProductTypeRow | null> {
  return database.productType.findUnique({
    where: { id: productTypeId },
    select: productTypeSelect,
  });
}

export async function listAttributeDefinitions(
  database: DatabaseClient,
  productTypeId: string,
): Promise<AttributeDefinitionRow[]> {
  const rows = await database.attributeDefinition.findMany({
    where: { productTypeId },
    select: attributeDefinitionSelect,
    orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
  });
  return rows.map(toDefinitionRow);
}

export async function listActiveAttributeRules(
  database: DatabaseClient,
  productTypeId: string,
): Promise<AttributeRule[]> {
  const definitions = await listAttributeDefinitions(database, productTypeId);
  return definitions.filter((definition) => definition.archivedAt === null).map(toAttributeRule);
}

export async function findAttributeDefinition(
  database: DatabaseClient,
  attributeDefinitionId: string,
): Promise<AttributeDefinitionRow | null> {
  const row = await database.attributeDefinition.findUnique({
    where: { id: attributeDefinitionId },
    select: attributeDefinitionSelect,
  });
  return row === null ? null : toDefinitionRow(row);
}

const lockedTypeRowsSchema = z.array(
  z.object({ id: z.string(), archived_at: z.date().nullable() }),
);

// Definition changes take FOR UPDATE; product and variant writes take FOR SHARE. Validation against
// a type's definitions therefore never races with a change to those definitions.
export async function lockProductTypeForDefinitionChange(
  database: DatabaseClient,
  productTypeId: string,
): Promise<{ archivedAt: Date | null } | null> {
  const rows = lockedTypeRowsSchema.parse(
    await database.$queryRaw`SELECT id, archived_at FROM product_types WHERE id = ${productTypeId}::uuid FOR UPDATE`,
  );
  const row = rows[0];
  return row === undefined ? null : { archivedAt: row.archived_at };
}

export async function lockProductTypeForProductWrite(
  database: DatabaseClient,
  productTypeId: string,
): Promise<{ archivedAt: Date | null } | null> {
  const rows = lockedTypeRowsSchema.parse(
    await database.$queryRaw`SELECT id, archived_at FROM product_types WHERE id = ${productTypeId}::uuid FOR SHARE`,
  );
  const row = rows[0];
  return row === undefined ? null : { archivedAt: row.archived_at };
}

export function insertProductType(
  database: DatabaseClient,
  data: { code: string; name: string; description: string | null },
): Promise<ProductTypeRow> {
  return database.productType.create({ data, select: productTypeSelect });
}

export function updateProductTypeRow(
  database: DatabaseClient,
  productTypeId: string,
  data: { name?: string; description?: string | null; archivedAt?: Date | null },
): Promise<ProductTypeRow> {
  return database.productType.update({
    where: { id: productTypeId },
    data,
    select: productTypeSelect,
  });
}

export function countUnarchivedProductsOfType(
  database: DatabaseClient,
  productTypeId: string,
): Promise<number> {
  return database.product.count({ where: { productTypeId, status: { not: 'ARCHIVED' } } });
}

export async function insertAttributeDefinition(
  database: DatabaseClient,
  data: Omit<AttributeDefinitionRow, 'id' | 'archivedAt'>,
): Promise<AttributeDefinitionRow> {
  const { allowedValues, ...fields } = data;
  const row = await database.attributeDefinition.create({
    data: { ...fields, ...(allowedValues === null ? {} : { allowedValues }) },
    select: attributeDefinitionSelect,
  });
  return toDefinitionRow(row);
}

export async function updateAttributeDefinitionRow(
  database: DatabaseClient,
  attributeDefinitionId: string,
  data: Partial<
    Pick<
      AttributeDefinitionRow,
      'label' | 'isRequired' | 'isFilterable' | 'isSearchable' | 'displayOrder' | 'archivedAt'
    >
  > & { allowedValues?: string[] },
): Promise<AttributeDefinitionRow> {
  const row = await database.attributeDefinition.update({
    where: { id: attributeDefinitionId },
    data,
    select: attributeDefinitionSelect,
  });
  return toDefinitionRow(row);
}

const countRowsSchema = z.tuple([z.object({ count: z.bigint() })]);

function toCount(rows: unknown): number {
  return Number(countRowsSchema.parse(rows)[0].count);
}

// Archived products keep the values they had; only products still in use must satisfy new rules.
export async function countProductsMissingAttribute(
  database: DatabaseClient,
  input: { productTypeId: string; code: string },
): Promise<number> {
  return toCount(
    await database.$queryRaw`
      SELECT count(*)::bigint AS count FROM products
      WHERE product_type_id = ${input.productTypeId}::uuid AND status <> 'ARCHIVED'
        AND (attributes -> ${input.code}) IS NULL`,
  );
}

export async function countVariantsMissingOption(
  database: DatabaseClient,
  input: { productTypeId: string; code: string },
): Promise<number> {
  return toCount(
    await database.$queryRaw`
      SELECT count(*)::bigint AS count FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE p.product_type_id = ${input.productTypeId}::uuid AND p.status <> 'ARCHIVED'
        AND v.status <> 'ARCHIVED' AND (v.option_values -> ${input.code}) IS NULL`,
  );
}

export async function countVariantsUsingOption(
  database: DatabaseClient,
  input: { productTypeId: string; code: string },
): Promise<number> {
  return toCount(
    await database.$queryRaw`
      SELECT count(*)::bigint AS count FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE p.product_type_id = ${input.productTypeId}::uuid AND p.status <> 'ARCHIVED'
        AND v.status <> 'ARCHIVED' AND (v.option_values -> ${input.code}) IS NOT NULL`,
  );
}

const valueRowsSchema = z.array(z.object({ value: z.string() }));

// One query for all removed values; containment (@>) uses the jsonb_path_ops GIN indexes.
export async function findAllowedValuesInUse(
  database: DatabaseClient,
  input: {
    productTypeId: string;
    code: string;
    dataType: AttributeDataType;
    scope: AttributeScope;
    values: readonly string[];
  },
): Promise<string[]> {
  if (input.values.length === 0) return [];
  const values = [...input.values];
  const rows =
    input.scope === 'VARIANT_OPTION'
      ? await database.$queryRaw`
          SELECT candidate.value FROM unnest(${values}::text[]) AS candidate(value)
          WHERE EXISTS (
            SELECT 1 FROM product_variants v JOIN products p ON p.id = v.product_id
            WHERE p.product_type_id = ${input.productTypeId}::uuid AND p.status <> 'ARCHIVED'
              AND v.status <> 'ARCHIVED'
              AND v.option_values @> jsonb_build_object(${input.code}::text, candidate.value))`
      : input.dataType === 'MULTI_ENUM'
        ? await database.$queryRaw`
          SELECT candidate.value FROM unnest(${values}::text[]) AS candidate(value)
          WHERE EXISTS (
            SELECT 1 FROM products p
            WHERE p.product_type_id = ${input.productTypeId}::uuid AND p.status <> 'ARCHIVED'
              AND p.attributes @> jsonb_build_object(${input.code}::text, jsonb_build_array(candidate.value)))`
        : await database.$queryRaw`
          SELECT candidate.value FROM unnest(${values}::text[]) AS candidate(value)
          WHERE EXISTS (
            SELECT 1 FROM products p
            WHERE p.product_type_id = ${input.productTypeId}::uuid AND p.status <> 'ARCHIVED'
              AND p.attributes @> jsonb_build_object(${input.code}::text, candidate.value))`;
  return valueRowsSchema.parse(rows).map(({ value }) => value);
}
