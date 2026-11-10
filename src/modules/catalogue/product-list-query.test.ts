import { describe, expect, it } from 'vitest';

import { CatalogueValidationError } from './catalogue.errors';
import { listProductsSchema } from './catalogue.schema';
import { buildProductListQuery, encodeListCursor, nextCursorFor } from './product-list-query';
import { slugFromName } from './slug';

const productId = '0195f2a0-0000-7000-8000-000000000001';

describe('buildProductListQuery', () => {
  it('hides archived products unless a status is asked for', () => {
    expect(buildProductListQuery(listProductsSchema.parse({})).where).toMatchObject({
      status: { not: 'ARCHIVED' },
    });
    expect(
      buildProductListQuery(listProductsSchema.parse({ status: 'ARCHIVED' })).where,
    ).toMatchObject({ status: 'ARCHIVED' });
  });

  it('asks for one row more than the page so the next page is known without another query', () => {
    expect(buildProductListQuery(listProductsSchema.parse({ limit: 10 })).take).toBe(11);
  });

  it('continues after the cursor row and counts without it', () => {
    const cursor = nextCursorFor('NEWEST', { id: productId, name: 'Kurta' });
    const query = buildProductListQuery(listProductsSchema.parse({ cursor }));
    expect(query.where).toEqual({ AND: [query.countWhere, { id: { lt: productId } }] });
  });

  it('pages by name and then id when sorting by name', () => {
    const cursor = nextCursorFor('NAME', { id: productId, name: 'Kurta' });
    const query = buildProductListQuery(listProductsSchema.parse({ sort: 'NAME', cursor }));
    expect(query.orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    expect(query.where).toEqual({
      AND: [
        query.countWhere,
        { OR: [{ name: { gt: 'Kurta' } }, { name: 'Kurta', id: { gt: productId } }] },
      ],
    });
  });

  it('refuses a cursor that was tampered with', () => {
    for (const cursor of [
      'not-base64-json',
      encodeListCursor({ sortValue: 'x', id: productId }).slice(0, -3),
      Buffer.from(JSON.stringify({ sortValue: 'x', id: 'not-a-uuid' })).toString('base64url'),
    ]) {
      expect(() => buildProductListQuery(listProductsSchema.parse({ cursor }))).toThrow(
        CatalogueValidationError,
      );
    }
  });
});

describe('slugFromName', () => {
  it('builds a lower-case hyphenated slug and drops accents and symbols', () => {
    expect(slugFromName('Cotton Kurta – Indigo')).toBe('cotton-kurta-indigo');
    expect(slugFromName('  Café  Crème 2.0 ')).toBe('cafe-creme-2-0');
    expect(slugFromName('!!!')).toBe('');
  });
});
