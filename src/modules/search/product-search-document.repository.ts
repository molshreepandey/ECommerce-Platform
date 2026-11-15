import { z } from 'zod';

import type { DatabaseClient } from '@/lib/db';

const optionValuesSchema = z.record(z.string(), z.string());

const documentRowsSchema = z.array(
  z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
    created_at: z.date(),
    attributes: z.record(z.string(), z.unknown()),
    product_group_id: z.string().nullable(),
    product_type_id: z.string(),
    product_type_code: z.string(),
    brand_id: z.string(),
    brand_name: z.string(),
    brand_slug: z.string(),
    categories: z.array(z.object({ id: z.string(), name: z.string() })),
    variants: z.array(
      z.object({
        optionValues: optionValuesSchema,
        pricePaise: z.number(),
        mrpPaise: z.number(),
        availableQuantity: z.number(),
      }),
    ),
    definitions: z.array(
      z.object({
        code: z.string(),
        scope: z.enum(['PRODUCT', 'VARIANT_OPTION']),
        isFilterable: z.boolean(),
        isSearchable: z.boolean(),
      }),
    ),
    rating: z.number().nullable(),
    review_count: z.number(),
    image_url: z.string().nullable(),
    image_alt: z.string().nullable(),
    document_version: z.bigint().transform(Number),
  }),
);

export type ProductDocumentRow = z.infer<typeof documentRowsSchema>[number];

// One statement for a whole sync batch (plan §12 Wave 6). Only ACTIVE variants count; available stock is
// the generated available_quantity summed over active warehouses (C17, D30). The version is the
// statement time in microseconds (below 2^53, so exact as a number): a later read always sees at least as new a state, so Elasticsearch's
// external versioning keeps the newest document when two syncs overlap.
export async function findProductDocumentRows(
  database: DatabaseClient,
  productIds: readonly string[],
): Promise<ProductDocumentRow[]> {
  if (productIds.length === 0) return [];
  return documentRowsSchema.parse(
    await database.$queryRaw`
      SELECT product.id::text AS id, product.slug, product.name, product.status::text AS status,
             product.created_at, product.attributes, product.product_group_id::text AS product_group_id,
             product.product_type_id::text AS product_type_id, product_type.code AS product_type_code,
             brand.id::text AS brand_id, brand.name AS brand_name, brand.slug AS brand_slug,
             coalesce((
               SELECT json_agg(json_build_object('id', ancestor.id::text, 'name', ancestor.name)
                               ORDER BY ancestor.level)
               FROM categories AS ancestor
               WHERE category.path LIKE ancestor.path || '%'
             ), '[]'::json) AS categories,
             coalesce((
               SELECT json_agg(json_build_object(
                        'optionValues', variant.option_values, 'pricePaise', variant.price_paise,
                        'mrpPaise', variant.mrp_paise, 'availableQuantity', coalesce(stock.available, 0))
                        ORDER BY variant.price_paise, variant.id)
               FROM product_variants AS variant
               LEFT JOIN LATERAL (
                 SELECT sum(level.available_quantity)::int AS available
                 FROM inventory_levels AS level
                 JOIN warehouses AS warehouse ON warehouse.id = level.warehouse_id AND warehouse.is_active
                 WHERE level.variant_id = variant.id
               ) AS stock ON true
               WHERE variant.product_id = product.id AND variant.status = 'ACTIVE'
             ), '[]'::json) AS variants,
             coalesce((
               SELECT json_agg(json_build_object(
                        'code', definition.code, 'scope', definition.scope,
                        'isFilterable', definition.is_filterable, 'isSearchable', definition.is_searchable))
               FROM attribute_definitions AS definition
               WHERE definition.product_type_id = product.product_type_id AND definition.archived_at IS NULL
             ), '[]'::json) AS definitions,
             review.rating, coalesce(review.review_count, 0)::int AS review_count,
             image.url AS image_url, image.alt_text AS image_alt,
             (extract(epoch FROM statement_timestamp()) * 1000000)::bigint AS document_version
      FROM unnest(${[...productIds]}::uuid[]) AS target(id)
      JOIN products AS product ON product.id = target.id
      JOIN product_types AS product_type ON product_type.id = product.product_type_id
      JOIN brands AS brand ON brand.id = product.brand_id
      LEFT JOIN categories AS category ON category.id = product.category_id
      LEFT JOIN LATERAL (
        SELECT round(avg(rating)::numeric, 1)::float AS rating, count(*)::int AS review_count
        FROM reviews WHERE reviews.product_id = product.id
      ) AS review ON true
      LEFT JOIN LATERAL (
        SELECT media.url, media.alt_text FROM product_media AS media
        WHERE media.product_id = product.id ORDER BY media.position, media.id LIMIT 1
      ) AS image ON true`,
  );
}

const versionRowsSchema = z.tuple([z.object({ version: z.bigint().transform(Number) })]);

// The version a removal carries: the same clock as findProductDocumentRows.
export async function currentDocumentVersion(database: DatabaseClient): Promise<number> {
  const [row] = versionRowsSchema.parse(
    await database.$queryRaw`SELECT (extract(epoch FROM statement_timestamp()) * 1000000)::bigint AS version`,
  );
  return row.version;
}

const idRowsSchema = z.array(z.object({ id: z.string() }));

// Every product id in key order, a page at a time, for a full reindex.
export async function listProductIdPage(
  database: DatabaseClient,
  input: { afterId: string | null; limit: number },
): Promise<string[]> {
  const rows = idRowsSchema.parse(
    input.afterId === null
      ? await database.$queryRaw`SELECT id::text AS id FROM products ORDER BY id LIMIT ${input.limit}`
      : await database.$queryRaw`
          SELECT id::text AS id FROM products WHERE id > ${input.afterId}::uuid ORDER BY id LIMIT ${input.limit}`,
  );
  return rows.map(({ id }) => id);
}
