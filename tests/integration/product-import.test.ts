import { beforeEach, describe, expect, it } from 'vitest';

import { parseCsv } from '@/lib/csv';
import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { exportProductsCsv, importProductsCsv } from '@/modules/catalogue/product-import.service';

import {
  actorFor,
  catalogueManager,
  createApparelType,
  createTestBrand,
  supportStaff,
} from './support/catalogue-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();
const header =
  'product_slug,product_name,brand_slug,description,gst_rate_percent,attr_fabric,attr_occasion,attr_care_instructions,sku,option_size,option_colour,mrp_rupees,price_rupees,weight_grams,length_mm,breadth_mm,height_mm';

function row(cells: Partial<Record<string, string>> = {}): string {
  const values: Record<string, string> = {
    product_slug: 'csv-kurta',
    product_name: 'CSV Kurta',
    brand_slug: 'test-brand',
    description: 'Made from a file',
    gst_rate_percent: '5',
    attr_fabric: 'Cotton',
    attr_occasion: 'Casual|Festive',
    attr_care_instructions: '',
    sku: 'CSV-KURTA-M',
    option_size: 'M',
    option_colour: 'White',
    mrp_rupees: '999',
    price_rupees: '799.50',
    weight_grams: '300',
    length_mm: '300',
    breadth_mm: '250',
    height_mm: '30',
    ...cells,
  };
  return header
    .split(',')
    .map((column) => values[column] ?? '')
    .join(',');
}

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof DomainError ? `${String(error.httpStatus)} ${error.code}` : String(error);
}

let productTypeId = '';

beforeEach(async () => {
  await truncateAllTestTables();
  productTypeId = (await createApparelType()).id;
  await createTestBrand();
});

describe('bulk product CSV upload and export (D16)', () => {
  it('creates draft products with their variants, audited and queued for search', async () => {
    const csv = [
      header,
      row(),
      row({ sku: 'CSV-KURTA-L', option_size: 'L' }),
      row({
        product_slug: 'csv-saree',
        product_name: 'CSV Saree',
        attr_fabric: 'Silk',
        attr_occasion: 'Festive',
        sku: 'CSV-SAREE-S',
        option_size: 'S',
        option_colour: '',
        gst_rate_percent: '12',
      }),
    ].join('\n');
    const result = await importProductsCsv(actorFor(), productTypeId, csv);
    expect(result).toEqual({ savedCount: 3, createdProductCount: 2, errors: [] });
    const kurta = await database.product.findUniqueOrThrow({
      where: { slug: 'csv-kurta' },
      select: {
        status: true,
        attributes: true,
        taxRateBasisPoints: true,
        variants: {
          select: { sku: true, pricePaise: true, mrpPaise: true },
          orderBy: { sku: 'asc' },
        },
      },
    });
    expect(kurta).toMatchObject({
      status: 'DRAFT',
      attributes: { fabric: 'Cotton', occasion: ['Casual', 'Festive'] },
      taxRateBasisPoints: 500,
      variants: [
        { sku: 'CSV-KURTA-L', pricePaise: 79_950, mrpPaise: 99_900 },
        { sku: 'CSV-KURTA-M', pricePaise: 79_950, mrpPaise: 99_900 },
      ],
    });
    expect(await database.auditLog.count({ where: { action: 'catalogue.product_created' } })).toBe(
      2,
    );
    expect(await database.auditLog.count({ where: { action: 'catalogue.variant_created' } })).toBe(
      3,
    );
    expect(await database.searchOutbox.count({ where: { processedAt: null } })).toBeGreaterThan(0);
  });

  it('reports bad rows by line and never writes them: a bad variant rejects its whole product only', async () => {
    const csv = [
      header,
      row({ product_slug: 'good-one', sku: 'GOOD-ONE-M' }),
      row({ product_slug: 'half-bad', sku: 'HALF-BAD-M' }),
      row({ product_slug: 'half-bad', sku: 'HALF-BAD-XL', option_size: 'XL' }),
      row({ product_slug: 'no-brand', sku: 'NO-BRAND-M', brand_slug: 'missing' }),
      row({ product_slug: 'cheap-mrp', sku: 'CHEAP-M', price_rupees: '1200' }),
      row({ product_slug: 'mixed', sku: 'MIXED-M' }),
      row({ product_slug: 'mixed', sku: 'MIXED-L', option_size: 'L', product_name: 'Other name' }),
    ].join('\n');
    const result = await importProductsCsv(actorFor(), productTypeId, csv);
    expect(result.createdProductCount).toBe(1);
    expect(result.savedCount).toBe(1);
    expect(result.errors.map(({ line }) => line)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(result.errors.find(({ line }) => line === 3)?.messages[0]).toMatch(/^Skipped: line 4/);
    expect(result.errors.find(({ line }) => line === 4)?.messages.join(' ')).toMatch(/size/);
    expect(result.errors.find(({ line }) => line === 5)?.messages).toContain(
      'brand_slug: no brand "missing"',
    );
    expect(result.errors.find(({ line }) => line === 8)?.messages[0]).toMatch(/differ from line 7/);
    expect(
      (await database.product.findMany({ select: { slug: true } })).map(({ slug }) => slug),
    ).toEqual(['good-one']);
    expect(await database.productVariant.count()).toBe(1);
  });

  it('reports an existing slug or SKU instead of overwriting, and rolls that product back', async () => {
    await importProductsCsv(actorFor(), productTypeId, [header, row()].join('\n'));
    const result = await importProductsCsv(
      actorFor(),
      productTypeId,
      [header, row(), row({ product_slug: 'new-slug', sku: 'CSV-KURTA-M' })].join('\n'),
    );
    expect(result.savedCount).toBe(0);
    expect(result.errors.map(({ line, messages }) => [line, messages[0]])).toEqual([
      [2, expect.stringMatching(/slug/i)],
      [3, expect.stringMatching(/SKU/i)],
    ]);
    expect(await database.product.count()).toBe(1);
  });

  it('refuses columns that do not match the type (422) and needs catalogue.write (403)', async () => {
    expect(
      await failure(importProductsCsv(actorFor(), productTypeId, 'product_slug,sku\na,b')),
    ).toBe('422 CSV_HEADER_INVALID');
    expect(
      await failure(
        importProductsCsv(actorFor(supportStaff), productTypeId, [header, row()].join('\n')),
      ),
    ).toBe('403 PERMISSION_DENIED');
  });

  it('exports the import layout; an export of an empty type is the template; re-importing it is refused as existing', async () => {
    const byColumn = (csv: string) => {
      const [columns = [], ...rows] = parseCsv(csv);
      return rows.map((cells) =>
        Object.fromEntries(columns.map((name, index) => [name, cells[index]])),
      );
    };
    const [templateHeader = [], ...templateRows] = parseCsv(
      await exportProductsCsv(catalogueManager, productTypeId),
    );
    expect([...templateHeader].sort()).toEqual(header.split(',').sort());
    expect(templateRows).toEqual([]);
    await importProductsCsv(actorFor(), productTypeId, [header, row()].join('\n'));
    const exported = await exportProductsCsv(catalogueManager, productTypeId);
    expect(byColumn(exported)).toEqual(
      byColumn([header, row({ gst_rate_percent: '5.00' })].join('\n')),
    );
    const again = await importProductsCsv(actorFor(), productTypeId, exported);
    expect(again.savedCount).toBe(0);
  });
});
