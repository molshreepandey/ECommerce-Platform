import { z } from 'zod';

import { Prisma } from '@/generated/prisma/client';
import type { DatabaseClient } from '@/lib/db';

import {
  pageCountFor,
  type ProductSearchHit,
  type ProductSearchFacets,
  type ProductSearchInput,
  type ProductSearchResult,
  type ProductSort,
  searchPageSize,
} from './product-search.schema';

// The PostgreSQL fallback used while Elasticsearch is unreachable (plan §10B, docs/redis-design.md §1.1).
// Same filters, sorts and page size; simpler text matching: the words must appear in the product, brand
// or category names, or be close to a word of the product name (pg_trgm), so it tolerates small typos
// in names but does not read searchable attribute text.

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function baseConditions(input: ProductSearchInput): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`product.status = 'ACTIVE'`];
  if (input.text !== undefined) {
    const pattern = likePattern(input.text);
    conditions.push(Prisma.sql`(
      product.name ILIKE ${pattern} OR brand.name ILIKE ${pattern}
      OR ${input.text} <% product.name
      OR EXISTS (SELECT 1 FROM categories AS ancestor
                 WHERE category.path LIKE ancestor.path || '%' AND ancestor.name ILIKE ${pattern}))`);
  }
  if (input.category !== null) {
    conditions.push(Prisma.sql`category.path LIKE ${input.category.path} || '%'`);
  }
  return Prisma.join(conditions, ' AND ');
}

function visibleProducts(input: ProductSearchInput): Prisma.Sql {
  const relevance =
    input.text === undefined
      ? Prisma.sql`0::float`
      : Prisma.sql`word_similarity(${input.text}, product.name)::float`;
  return productCardRows(relevance, baseConditions(input));
}

// One row per sellable product with what a product card shows (cheapest active variant, stock over
// active warehouses, rating, first image).
function productCardRows(relevance: Prisma.Sql, conditions: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT product.id, product.slug, product.name, product.created_at, product.attributes,
           product.product_type_id, brand.name AS brand_name, brand.slug AS brand_slug,
           cheapest.price_paise AS min_price_paise, cheapest.mrp_paise,
           coalesce(stock.available, 0)::int AS available_quantity,
           review.rating, coalesce(review.review_count, 0)::int AS review_count,
           image.url AS image_url, image.alt_text AS image_alt, ${relevance} AS relevance
    FROM products AS product
    JOIN brands AS brand ON brand.id = product.brand_id
    LEFT JOIN categories AS category ON category.id = product.category_id
    JOIN LATERAL (
      SELECT variant.price_paise, variant.mrp_paise FROM product_variants AS variant
      WHERE variant.product_id = product.id AND variant.status = 'ACTIVE'
      ORDER BY variant.price_paise, variant.id LIMIT 1
    ) AS cheapest ON true
    LEFT JOIN LATERAL (
      SELECT sum(level.available_quantity) AS available
      FROM product_variants AS variant
      JOIN inventory_levels AS level ON level.variant_id = variant.id
      JOIN warehouses AS warehouse ON warehouse.id = level.warehouse_id AND warehouse.is_active
      WHERE variant.product_id = product.id AND variant.status = 'ACTIVE'
    ) AS stock ON true
    LEFT JOIN LATERAL (
      SELECT round(avg(rating)::numeric, 1)::float AS rating, count(*) AS review_count
      FROM reviews WHERE reviews.product_id = product.id
    ) AS review ON true
    LEFT JOIN LATERAL (
      SELECT media.url, media.alt_text FROM product_media AS media
      WHERE media.product_id = product.id ORDER BY media.position, media.id LIMIT 1
    ) AS image ON true
    WHERE ${conditions}`;
}

function narrowingConditions(input: ProductSearchInput): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`true`];
  if (input.brandSlugs.length > 0)
    conditions.push(Prisma.sql`brand_slug = ANY(${input.brandSlugs})`);
  if (input.minPricePaise !== undefined) {
    conditions.push(Prisma.sql`min_price_paise >= ${input.minPricePaise}`);
  }
  if (input.maxPricePaise !== undefined) {
    conditions.push(Prisma.sql`min_price_paise <= ${input.maxPricePaise}`);
  }
  if (input.inStockOnly) conditions.push(Prisma.sql`available_quantity > 0`);
  if (input.minimumRating !== undefined) {
    conditions.push(Prisma.sql`rating >= ${input.minimumRating}`);
  }
  for (const attribute of input.attributeFilters) {
    conditions.push(Prisma.sql`(
      attributes ->> ${attribute.code} = ANY(${attribute.values})
      OR (jsonb_typeof(attributes -> ${attribute.code}) = 'array'
          AND attributes -> ${attribute.code} ?| ${attribute.values})
      OR EXISTS (SELECT 1 FROM product_variants AS variant
                 WHERE variant.product_id = visible.id AND variant.status = 'ACTIVE'
                   AND variant.option_values ->> ${attribute.code} = ANY(${attribute.values})))`);
  }
  return Prisma.join(conditions, ' AND ');
}

const orderBy: Record<ProductSort, Prisma.Sql> = {
  relevance: Prisma.sql`relevance DESC, created_at DESC, id`,
  price_asc: Prisma.sql`min_price_paise, id`,
  price_desc: Prisma.sql`min_price_paise DESC, id`,
  newest: Prisma.sql`created_at DESC, id`,
  rating: Prisma.sql`rating DESC NULLS LAST, review_count DESC, id`,
};

const pageRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  brand_name: z.string(),
  image_url: z.string().nullable(),
  image_alt: z.string().nullable(),
  min_price_paise: z.number(),
  mrp_paise: z.number(),
  available_quantity: z.number(),
  rating: z.number().nullable(),
  review_count: z.number(),
  total_count: z.number(),
});
const pageRowsSchema = z.array(pageRowSchema);

const brandRowsSchema = z.array(
  z.object({ slug: z.string(), name: z.string(), count: z.number() }),
);
const attributeRowsSchema = z.array(
  z.object({ code: z.string(), value: z.string(), count: z.number() }),
);

async function findFacets(
  database: DatabaseClient,
  input: ProductSearchInput,
): Promise<ProductSearchFacets> {
  const brands = brandRowsSchema.parse(
    await database.$queryRaw`
      WITH visible AS (${visibleProducts(input)})
      SELECT brand_slug AS slug, min(brand_name) AS name, count(*)::int AS count
      FROM visible GROUP BY brand_slug ORDER BY brand_slug`,
  );
  const attributes = attributeRowsSchema.parse(
    await database.$queryRaw`
      WITH visible AS (${visibleProducts(input)})
      SELECT definition.code, found.value, count(DISTINCT visible.id)::int AS count
      FROM visible
      JOIN attribute_definitions AS definition
        ON definition.product_type_id = visible.product_type_id
       AND definition.is_filterable AND definition.archived_at IS NULL
      CROSS JOIN LATERAL (
        SELECT jsonb_array_elements_text(
                 CASE WHEN jsonb_typeof(visible.attributes -> definition.code) = 'array'
                      THEN visible.attributes -> definition.code
                      ELSE jsonb_build_array(visible.attributes -> definition.code) END) AS value
        WHERE definition.scope = 'PRODUCT' AND visible.attributes ? definition.code
        UNION ALL
        SELECT variant.option_values ->> definition.code
        FROM product_variants AS variant
        WHERE definition.scope = 'VARIANT_OPTION' AND variant.product_id = visible.id
          AND variant.status = 'ACTIVE' AND variant.option_values ? definition.code
      ) AS found
      WHERE found.value IS NOT NULL AND found.value <> ''
      GROUP BY definition.code, found.value ORDER BY definition.code, found.value`,
  );
  const valuesByCode = new Map<string, { value: string; count: number }[]>();
  for (const row of attributes) {
    const values = valuesByCode.get(row.code) ?? [];
    values.push({ value: row.value, count: row.count });
    valuesByCode.set(row.code, values);
  }
  return {
    brands,
    attributes: [...valuesByCode].map(([code, values]) => ({ code, values })),
  };
}

export async function searchProductsInPostgres(
  database: DatabaseClient,
  input: ProductSearchInput,
): Promise<ProductSearchResult> {
  const rows = pageRowsSchema.parse(
    await database.$queryRaw`
      WITH visible AS (${visibleProducts(input)})
      SELECT id::text AS id, slug, name, brand_name, image_url, image_alt, min_price_paise, mrp_paise,
             available_quantity, rating, review_count, (count(*) OVER ())::int AS total_count
      FROM visible WHERE ${narrowingConditions(input)}
      ORDER BY ${orderBy[input.sort]}
      LIMIT ${searchPageSize} OFFSET ${(input.page - 1) * searchPageSize}`,
  );
  const totalCount = rows[0]?.total_count ?? 0;
  return {
    hits: rows.map((row) => ({
      productId: row.id,
      slug: row.slug,
      name: row.name,
      brandName: row.brand_name,
      imageUrl: row.image_url,
      imageAlt: row.image_alt,
      minPricePaise: row.min_price_paise,
      mrpPaise: row.mrp_paise,
      inStock: row.available_quantity > 0,
      rating: row.rating,
      reviewCount: row.review_count,
    })),
    totalCount,
    page: input.page,
    pageCount: pageCountFor(totalCount),
    facets: await findFacets(database, input),
    source: 'postgres',
  };
}

// Collection pages (C13): product cards for hand-picked products, in the given order; products that are
// not sellable are left out.
export async function findProductCardsByIds(
  database: DatabaseClient,
  productIds: readonly string[],
): Promise<ProductSearchHit[]> {
  if (productIds.length === 0) return [];
  const rows = pageRowSchema
    .omit({ total_count: true })
    .array()
    .parse(
      await database.$queryRaw`
      WITH visible AS (${productCardRows(
        Prisma.sql`0::float`,
        Prisma.sql`product.status = 'ACTIVE' AND product.id = ANY(${[...productIds]}::uuid[])`,
      )})
      SELECT id::text AS id, slug, name, brand_name, image_url, image_alt, min_price_paise, mrp_paise,
             available_quantity, rating, review_count
      FROM visible`,
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return productIds.flatMap((productId) => {
    const row = byId.get(productId);
    if (row === undefined) return [];
    return [
      {
        productId: row.id,
        slug: row.slug,
        name: row.name,
        brandName: row.brand_name,
        imageUrl: row.image_url,
        imageAlt: row.image_alt,
        minPricePaise: row.min_price_paise,
        mrpPaise: row.mrp_paise,
        inStock: row.available_quantity > 0,
        rating: row.rating,
        reviewCount: row.review_count,
      },
    ];
  });
}

// C14 fallback: sellable products whose name contains the text (pg_trgm GIN index on products.name),
// names starting with it first.
export function suggestProductsInPostgres(
  database: DatabaseClient,
  text: string,
  limit: number,
): Promise<{ name: string; slug: string }[]> {
  const pattern = likePattern(text);
  const prefix = `${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  return database.$queryRaw<{ name: string; slug: string }[]>`
    SELECT product.name, product.slug
    FROM products AS product
    WHERE product.status = 'ACTIVE' AND product.name ILIKE ${pattern}
      AND EXISTS (SELECT 1 FROM product_variants AS variant
                  WHERE variant.product_id = product.id AND variant.status = 'ACTIVE')
    ORDER BY (product.name ILIKE ${prefix}) DESC, product.name, product.id
    LIMIT ${limit}`;
}
