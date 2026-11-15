import { cacheTags, expireCacheTags } from '@/lib/cache-tags';
import { getDatabase } from '@/lib/db';
import { getLogger } from '@/lib/logger';

import { syncProductsToSearchIndex } from './product-search-index.service';
import { listUnprocessedProductRows, markOutboxRowsProcessed } from './search-outbox.repository';

export interface OutboxDrainResult {
  processedRowCount: number;
  indexedProductCount: number;
  removedProductCount: number;
  hasMore: boolean;
}

const defaultBatchSize = 100;
const defaultMaxBatches = 10;

// One batch: sync the products to Elasticsearch, expire their cached pages (product and product-group
// tags), then mark the rows processed. Any failure leaves the rows unprocessed for the next drain
// (docs/redis-design.md §5.2), so neither the index nor a cached page stays behind for good.
async function processBatch(batchSize: number) {
  const database = getDatabase();
  const rows = await listUnprocessedProductRows(database, batchSize);
  if (rows.length === 0) return null;
  const productIds = [...new Set(rows.map(({ entityId }) => entityId))];
  const synced = await syncProductsToSearchIndex(productIds);
  await expireCacheTags([
    ...productIds.map(cacheTags.product),
    ...synced.productGroupIds.map(cacheTags.productGroup),
  ]);
  await markOutboxRowsProcessed(
    database,
    rows.map(({ id }) => id),
  );
  return { rows: rows.length, synced, full: rows.length === batchSize };
}

export async function drainSearchOutbox(
  options: { batchSize?: number; maxBatches?: number } = {},
): Promise<OutboxDrainResult> {
  const batchSize = options.batchSize ?? defaultBatchSize;
  const maxBatches = options.maxBatches ?? defaultMaxBatches;
  const result: OutboxDrainResult = {
    processedRowCount: 0,
    indexedProductCount: 0,
    removedProductCount: 0,
    hasMore: false,
  };
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const processed = await processBatch(batchSize);
    if (processed === null) return result;
    result.processedRowCount += processed.rows;
    result.indexedProductCount += processed.synced.indexedProductIds.length;
    result.removedProductCount += processed.synced.removedProductIds.length;
    result.hasMore = processed.full;
    if (!processed.full) return result;
  }
  return result;
}

let runningDrain: Promise<void> | null = null;
const drainState = { isRequested: false };

// Read through a function: another call can set the flag while this drain awaits.
function isDrainRequested(): boolean {
  return drainState.isRequested;
}

// One drain at a time per process; a request that arrives during a drain makes it run once more, so its
// rows are never left waiting for the next admin change.
async function drainUntilIdle(): Promise<void> {
  do {
    drainState.isRequested = false;
    try {
      await drainSearchOutbox();
    } catch (error) {
      getLogger().warn({ err: error }, 'search outbox drain failed; rows stay queued');
      return;
    }
  } while (isDrainRequested());
}

export function drainSearchOutboxInBackground(): Promise<void> {
  if (runningDrain !== null) {
    drainState.isRequested = true;
    return runningDrain;
  }
  runningDrain = drainUntilIdle().finally(() => {
    runningDrain = null;
  });
  return runningDrain;
}
