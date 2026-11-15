import { beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import {
  getSearchIndexStatus,
  reindexSearchNow,
  syncSearchIndexNow,
} from '@/modules/search/search-admin.service';
import { enqueueProductsReindex } from '@/modules/search/search-outbox.repository';

import { testMetadata } from './support/identity-fixtures';
import { createStaffMember, createVariantRow } from './support/inventory-fixtures';
import { truncateAllTestTables } from './support/test-database';

const database = getDatabase();

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof DomainError ? `${String(error.httpStatus)} ${error.code}` : String(error);
}

beforeEach(async () => {
  await truncateAllTestTables();
});

describe('search index tools (D48)', () => {
  it('shows the outbox backlog, drains it with "Sync now" and audits it', async () => {
    const staff = await createStaffMember(['search.manage']);
    const products = [await createVariantRow(), await createVariantRow()];
    await enqueueProductsReindex(
      database,
      products.map(({ productId }) => productId),
    );
    const before = await getSearchIndexStatus(staff);
    expect(before).toMatchObject({ isElasticsearchReachable: true, pendingOutboxCount: 2 });
    expect(before.oldestPendingAt).not.toBeNull();
    const sync = await syncSearchIndexNow(staff, testMetadata());
    expect(sync.processedRowCount).toBe(2);
    expect(await getSearchIndexStatus(staff)).toMatchObject({
      pendingOutboxCount: 0,
      oldestPendingAt: null,
    });
    expect(await database.auditLog.count({ where: { action: 'search.outbox_drained' } })).toBe(1);
  });

  it('a full reindex builds a new version behind the alias with every sellable product', async () => {
    const staff = await createStaffMember(['search.manage']);
    await createVariantRow();
    await createVariantRow();
    const result = await reindexSearchNow(staff, testMetadata());
    expect(result.productCount).toBe(2);
    const status = await getSearchIndexStatus(staff);
    expect(status.indexNames).toEqual([result.indexName]);
    expect(status.documentCount).toBe(2);
    const again = await reindexSearchNow(staff, testMetadata());
    expect(again.indexName).not.toBe(result.indexName);
    expect((await getSearchIndexStatus(staff)).indexNames).toEqual([again.indexName]);
    expect(await database.auditLog.count({ where: { action: 'search.reindexed' } })).toBe(2);
  });

  it('needs search.manage (403)', async () => {
    const staff = await createStaffMember(['catalogue.read']);
    expect(await failure(getSearchIndexStatus(staff))).toBe('403 PERMISSION_DENIED');
    expect(await failure(syncSearchIndexNow(staff, testMetadata()))).toBe('403 PERMISSION_DENIED');
    expect(await failure(reindexSearchNow(staff, testMetadata()))).toBe('403 PERMISSION_DENIED');
  });
});
