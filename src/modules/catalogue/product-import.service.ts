import { z } from 'zod';

import { type CsvCell, csvRecordsOrThrow, type CsvRowError, toCsv, zodMessages } from '@/lib/csv';
import { type DatabaseClient, getDatabase, isUniqueViolation } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { paiseToRupeesText, rupeesTextToPaise } from '@/lib/money';
import { assertStaffPermission, type StaffContext } from '@/modules/identity/access-control';

import type { AttributeRule } from './attribute-validation';
import type { CatalogueActor } from './catalogue-audit';
import { CatalogueNotFoundError } from './catalogue.errors';
import {
  type CreateProductInput,
  createProductSchema,
  type CreateVariantInput,
  createVariantSchema,
} from './catalogue.schema';
import { createProductInTransaction, rethrowProductConflict } from './product.service';
import { findProductType, listActiveAttributeRules } from './product-type.repository';
import { createVariantInTransaction, rethrowVariantConflict } from './variant.service';

// D16: one CSV row per variant; rows with the same product_slug make one product. Product attributes are
// `attr_<code>` columns, variant options `option_<code>`; a multi-value attribute separates values with |.
const productColumns = [
  'product_slug',
  'product_name',
  'brand_slug',
  'description',
  'gst_rate_percent',
];
const variantColumns = [
  'sku',
  'mrp_rupees',
  'price_rupees',
  'weight_grams',
  'length_mm',
  'breadth_mm',
  'height_mm',
];

export function productCsvColumns(
  rules: readonly Pick<AttributeRule, 'code' | 'scope'>[],
): string[] {
  return [
    ...productColumns,
    ...rules.filter(({ scope }) => scope === 'PRODUCT').map(({ code }) => `attr_${code}`),
    'sku',
    ...rules.filter(({ scope }) => scope === 'VARIANT_OPTION').map(({ code }) => `option_${code}`),
    ...variantColumns.slice(1),
  ];
}

function attributeValue(rule: AttributeRule, text: string): unknown {
  switch (rule.dataType) {
    case 'TEXT':
    case 'ENUM':
      return text;
    case 'NUMBER':
      return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
    case 'BOOLEAN': {
      const lower = text.toLowerCase();
      if (lower === 'yes' || lower === 'true') return true;
      if (lower === 'no' || lower === 'false') return false;
      return text;
    }
    case 'MULTI_ENUM':
      return text
        .split('|')
        .map((value) => value.trim())
        .filter((value) => value !== '');
  }
}

function attributeText(rule: AttributeRule, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (rule.dataType === 'MULTI_ENUM' && Array.isArray(value)) return value.map(String).join('|');
  if (rule.dataType === 'BOOLEAN') return value === true ? 'yes' : 'no';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

const wholeNumber = (text: string): unknown => (/^\d+$/.test(text) ? Number(text) : text);
const rupees = (text: string): unknown => rupeesTextToPaise(text) ?? text;

function basisPoints(text: string): unknown {
  return /^\d{1,3}(\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 100) : text;
}

interface ImportRow {
  line: number;
  slug: string;
  productFields: Record<string, string>;
  product: CreateProductInput | null;
  variant: CreateVariantInput | null;
  messages: string[];
}

function rowFromRecord(
  record: { line: number; values: Record<string, string> },
  rules: readonly AttributeRule[],
  productTypeId: string,
  brandIds: ReadonlyMap<string, string>,
): ImportRow {
  const values = record.values;
  const text = (column: string) => values[column] ?? '';
  const messages: string[] = [];
  const attributes = Object.fromEntries(
    rules
      .filter(({ scope }) => scope === 'PRODUCT')
      .flatMap((rule) => {
        const cell = text(`attr_${rule.code}`);
        return cell === '' ? [] : [[rule.code, attributeValue(rule, cell)]];
      }),
  );
  const brandSlug = text('brand_slug').toLowerCase();
  const brandId = brandIds.get(brandSlug);
  if (brandId === undefined) messages.push(`brand_slug: no brand "${brandSlug}"`);
  const product = createProductSchema.safeParse({
    productTypeId,
    brandId: brandId ?? '00000000-0000-7000-8000-000000000000',
    name: text('product_name'),
    slug: text('product_slug'),
    description: text('description'),
    attributes,
    taxRateBasisPoints: basisPoints(text('gst_rate_percent')),
  });
  if (!product.success) messages.push(...zodMessages(product.error));
  const variant = createVariantSchema.safeParse({
    sku: text('sku'),
    optionValues: Object.fromEntries(
      rules
        .filter(({ scope }) => scope === 'VARIANT_OPTION')
        .flatMap(({ code }) => {
          const cell = text(`option_${code}`);
          return cell === '' ? [] : [[code, cell]];
        }),
    ),
    mrpPaise: rupees(text('mrp_rupees')),
    pricePaise: rupees(text('price_rupees')),
    weightGrams: wholeNumber(text('weight_grams')),
    lengthMm: wholeNumber(text('length_mm')),
    breadthMm: wholeNumber(text('breadth_mm')),
    heightMm: wholeNumber(text('height_mm')),
  });
  if (!variant.success) messages.push(...zodMessages(variant.error));
  return {
    line: record.line,
    slug: text('product_slug').toLowerCase(),
    productFields: Object.fromEntries(
      Object.entries(values).filter(
        ([column]) => !variantColumns.includes(column) && !column.startsWith('option_'),
      ),
    ),
    product: product.success && brandId !== undefined ? product.data : null,
    variant: variant.success ? variant.data : null,
    messages,
  };
}

const fieldErrorDetailsSchema = z.object({
  fieldErrors: z.record(z.string(), z.array(z.string())),
});
const jsonObjectSchema = z.record(z.string(), z.unknown());

// A domain error as row messages: field errors one per field, anything else its message.
function errorMessages(error: unknown): string[] {
  if (!(error instanceof DomainError)) throw error;
  const details = fieldErrorDetailsSchema.safeParse(error.details);
  if (!details.success) return [error.message];
  return Object.entries(details.data.fieldErrors).flatMap(([field, list]) =>
    list.map((message) => `${field}: ${message}`),
  );
}

function conflictMessages(error: unknown, rethrow: (error: unknown) => never): string[] {
  try {
    rethrow(error);
  } catch (mapped) {
    return errorMessages(mapped);
  }
}

class RowFailure extends Error {
  constructor(
    readonly line: number,
    readonly messages: string[],
  ) {
    super('row failed');
  }
}

async function createOneProduct(
  database: DatabaseClient,
  actor: CatalogueActor,
  rows: readonly ImportRow[],
): Promise<void> {
  const [first] = rows;
  if (first?.product == null) return;
  const productInput = { ...first.product, slug: first.slug };
  await database.$transaction(async (transaction) => {
    let product: Awaited<ReturnType<typeof createProductInTransaction>>;
    try {
      product = await createProductInTransaction(transaction, actor, productInput);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new RowFailure(first.line, conflictMessages(error, rethrowProductConflict));
      }
      throw new RowFailure(first.line, errorMessages(error));
    }
    for (const row of rows) {
      if (row.variant === null) continue;
      let signature: string | undefined;
      try {
        await createVariantInTransaction(
          transaction,
          actor,
          product.id,
          row.variant,
          (computed) => {
            signature = computed;
          },
        );
      } catch (error) {
        const sku = row.variant.sku;
        throw new RowFailure(
          row.line,
          isUniqueViolation(error)
            ? conflictMessages(error, (caught) =>
                rethrowVariantConflict(caught, {
                  sku,
                  ...(signature === undefined ? {} : { optionSignature: signature }),
                }),
              )
            : errorMessages(error),
        );
      }
    }
  });
}

export interface ProductImportResult {
  savedCount: number;
  createdProductCount: number;
  errors: CsvRowError[];
}

async function typeRules(database: DatabaseClient, productTypeId: string) {
  const productType = await findProductType(database, productTypeId);
  if (productType === null) throw new CatalogueNotFoundError('PRODUCT_TYPE');
  return listActiveAttributeRules(database, productTypeId);
}

// D16: creates new products (as drafts) with their variants. Each product is all or nothing: a bad row
// rejects its whole product (its other rows are reported as skipped), never half a product; other
// products in the file are still created. Existing slugs and SKUs are reported, never overwritten.
export async function importProductsCsv(
  actor: CatalogueActor,
  productTypeId: string,
  csv: string,
): Promise<ProductImportResult> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  const database = getDatabase();
  const rules = await typeRules(database, productTypeId);
  const records = csvRecordsOrThrow(csv, productCsvColumns(rules));
  const brandSlugs = [
    ...new Set(records.map(({ values }) => (values['brand_slug'] ?? '').toLowerCase())),
  ];
  const brands = await database.brand.findMany({
    where: { slug: { in: brandSlugs } },
    select: { id: true, slug: true },
  });
  const brandIds = new Map(brands.map(({ slug, id }) => [slug, id]));
  const groups = Map.groupBy(
    records.map((record) => rowFromRecord(record, rules, productTypeId, brandIds)),
    (row) => row.slug,
  );
  const errors: CsvRowError[] = [];
  let savedCount = 0;
  let createdProductCount = 0;
  for (const rows of groups.values()) {
    const first = rows[0];
    if (first === undefined) continue;
    for (const row of rows.slice(1)) {
      if (JSON.stringify(row.productFields) !== JSON.stringify(first.productFields)) {
        row.messages.push(
          `Product columns differ from line ${String(first.line)} of the same product`,
        );
      }
    }
    const failed = rows.filter((row) => row.messages.length > 0);
    if (failed.length > 0) {
      for (const row of rows) {
        errors.push({
          line: row.line,
          messages:
            row.messages.length > 0
              ? row.messages
              : [`Skipped: line ${String(failed[0]?.line)} of the same product has errors`],
        });
      }
      continue;
    }
    try {
      await createOneProduct(database, actor, rows);
      savedCount += rows.length;
      createdProductCount += 1;
    } catch (error) {
      if (!(error instanceof RowFailure)) throw error;
      for (const row of rows) {
        errors.push({
          line: row.line,
          messages:
            row.line === error.line
              ? error.messages
              : [`Skipped: line ${String(error.line)} of the same product has errors`],
        });
      }
    }
  }
  errors.sort((left, right) => left.line - right.line);
  return { savedCount, createdProductCount, errors };
}

const exportProductLimit = 2_000;

// D16 export: the type's products (not archived) in the import layout, one row per non-archived variant;
// with no products it is the empty template for that type.
export async function exportProductsCsv(
  staff: StaffContext,
  productTypeId: string,
): Promise<string> {
  assertStaffPermission(staff, 'catalogue.read');
  const database = getDatabase();
  const rules = await typeRules(database, productTypeId);
  const products = await database.product.findMany({
    where: { productTypeId, status: { not: 'ARCHIVED' } },
    select: {
      slug: true,
      name: true,
      description: true,
      taxRateBasisPoints: true,
      attributes: true,
      brand: { select: { slug: true } },
      variants: {
        where: { status: { not: 'ARCHIVED' } },
        select: {
          sku: true,
          optionValues: true,
          mrpPaise: true,
          pricePaise: true,
          weightGrams: true,
          lengthMm: true,
          breadthMm: true,
          heightMm: true,
        },
        orderBy: { sku: 'asc' },
      },
    },
    orderBy: { slug: 'asc' },
    take: exportProductLimit,
  });
  const productRules = rules.filter(({ scope }) => scope === 'PRODUCT');
  const optionRules = rules.filter(({ scope }) => scope === 'VARIANT_OPTION');
  const record = (value: unknown): Record<string, unknown> => {
    const parsed = jsonObjectSchema.safeParse(value);
    return parsed.success ? parsed.data : {};
  };
  return toCsv(
    productCsvColumns(rules),
    products.flatMap((product) =>
      product.variants.map((variant): CsvCell[] => [
        product.slug,
        product.name,
        product.brand.slug,
        product.description,
        (product.taxRateBasisPoints / 100).toFixed(2),
        ...productRules.map((rule) => attributeText(rule, record(product.attributes)[rule.code])),
        variant.sku,
        ...optionRules.map((rule) => attributeText(rule, record(variant.optionValues)[rule.code])),
        paiseToRupeesText(variant.mrpPaise),
        paiseToRupeesText(variant.pricePaise),
        variant.weightGrams,
        variant.lengthMm,
        variant.breadthMm,
        variant.heightMm,
      ]),
    ),
  );
}
