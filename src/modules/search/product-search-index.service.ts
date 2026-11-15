import { errors, type estypes } from '@elastic/elasticsearch';

import { getDatabase } from '@/lib/db';
import { getElasticsearchClient } from '@/lib/elasticsearch';

import { buildProductSearchDocument, type ProductSearchDocument } from './product-search-document';
import {
  currentDocumentVersion,
  findProductDocumentRows,
  listProductIdPage,
} from './product-search-document.repository';
import {
  productSearchAlias,
  productSearchIndexName,
  productSearchMappings,
  productSearchSettings,
} from './product-search-index';
import { productIdsQueuedSince } from './search-outbox.repository';

export interface ProductSyncResult {
  indexedProductIds: string[];
  removedProductIds: string[];
  productGroupIds: string[];
}

function isResourceAlreadyExists(error: unknown): boolean {
  return (
    error instanceof errors.ResponseError &&
    JSON.stringify(error.body).includes('resource_already_exists_exception')
  );
}

async function versionedIndicesBehindAlias(): Promise<string[]> {
  const client = getElasticsearchClient();
  const alias = productSearchAlias();
  if (!(await client.indices.existsAlias({ name: alias }))) return [];
  return Object.keys(await client.indices.getAlias({ name: alias }));
}

async function createVersionedIndex(version: number, withAlias: boolean): Promise<string> {
  const index = productSearchIndexName(version);
  await getElasticsearchClient().indices.create({
    index,
    settings: productSearchSettings,
    mappings: productSearchMappings,
    ...(withAlias ? { aliases: { [productSearchAlias()]: { is_write_index: true } } } : {}),
  });
  return index;
}

// Creates `<alias>_v1` with the alias when nothing exists yet; a concurrent creator wins harmlessly.
export async function ensureProductSearchIndex(): Promise<void> {
  if ((await versionedIndicesBehindAlias()).length > 0) return;
  try {
    await createVersionedIndex(1, true);
  } catch (error) {
    if (!isResourceAlreadyExists(error)) throw error;
  }
}

// A bulk item failure other than "an equal or newer version is already there" (409) or "already
// removed" (404 on delete) is an error; those two are the expected results of overlapping syncs.
function assertBulkSucceeded(response: estypes.BulkResponse): void {
  if (!response.errors) return;
  const failures = response.items.flatMap((item) =>
    Object.values(item).filter(
      (result) =>
        result.error !== undefined &&
        result.status !== 409 &&
        !(result.status === 404 && item.delete !== undefined),
    ),
  );
  if (failures.length > 0) {
    throw new Error(`Search index update failed: ${JSON.stringify(failures[0]?.error)}`);
  }
}

async function writeDocuments(
  index: string,
  productIds: readonly string[],
): Promise<ProductSyncResult> {
  const database = getDatabase();
  const rows = await findProductDocumentRows(database, productIds);
  const operations: (estypes.BulkOperationContainer | ProductSearchDocument)[] = [];
  const result: ProductSyncResult = {
    indexedProductIds: [],
    removedProductIds: [],
    productGroupIds: [],
  };
  for (const row of rows) {
    if (row.product_group_id !== null) result.productGroupIds.push(row.product_group_id);
    const document = buildProductSearchDocument(row);
    const target = {
      _index: index,
      _id: row.id,
      version: row.document_version,
      version_type: 'external' as const,
    };
    if (document === null) {
      operations.push({ delete: target });
      result.removedProductIds.push(row.id);
    } else {
      operations.push({ index: target }, document);
      result.indexedProductIds.push(row.id);
    }
  }
  const foundIds = new Set(rows.map(({ id }) => id));
  const missingIds = productIds.filter((productId) => !foundIds.has(productId.toLowerCase()));
  if (missingIds.length > 0) {
    const version = await currentDocumentVersion(database);
    for (const productId of missingIds) {
      operations.push({
        delete: { _index: index, _id: productId, version, version_type: 'external' },
      });
      result.removedProductIds.push(productId);
    }
  }
  if (operations.length === 0) return result;
  assertBulkSucceeded(await getElasticsearchClient().bulk({ operations, refresh: false }));
  return result;
}

// Brings the documents of these products in line with PostgreSQL now (idempotent).
export async function syncProductsToSearchIndex(
  productIds: readonly string[],
): Promise<ProductSyncResult> {
  await ensureProductSearchIndex();
  return writeDocuments(productSearchAlias(), [
    ...new Set(productIds.map((id) => id.toLowerCase())),
  ]);
}

export async function refreshProductSearchIndex(): Promise<void> {
  await getElasticsearchClient().indices.refresh({ index: productSearchAlias() });
}

const reindexPageSize = 500;

// Zero-downtime full rebuild: build `<alias>_v<n+1>`, swap the alias in one atomic action, re-sync
// products queued while it ran, then drop the old index. Two reindexes at once cannot both run: the
// second fails to create the same new index name.
export async function reindexAllProducts(): Promise<{ indexName: string; productCount: number }> {
  const client = getElasticsearchClient();
  const alias = productSearchAlias();
  const existing = await client.indices.get({ index: `${alias}_v*`, allow_no_indices: true });
  const highestVersion = Math.max(
    0,
    ...Object.keys(existing).map((name) => Number(name.slice(`${alias}_v`.length)) || 0),
  );
  const startedAt = new Date();
  const indexName = await createVersionedIndex(highestVersion + 1, false);
  let productCount = 0;
  let afterId: string | null = null;
  for (;;) {
    const page = await listProductIdPage(getDatabase(), { afterId, limit: reindexPageSize });
    if (page.length === 0) break;
    productCount += (await writeDocuments(indexName, page)).indexedProductIds.length;
    afterId = page.at(-1) ?? null;
  }
  await client.indices.refresh({ index: indexName });
  const previous = await versionedIndicesBehindAlias();
  await client.indices.updateAliases({
    actions: [
      ...previous.map((index) => ({ remove: { index, alias } })),
      { add: { index: indexName, alias, is_write_index: true } },
    ],
  });
  const queuedMeanwhile = await productIdsQueuedSince(getDatabase(), startedAt);
  if (queuedMeanwhile.length > 0) await writeDocuments(alias, queuedMeanwhile);
  const stale = Object.keys(existing).filter((name) => name !== indexName);
  if (stale.length > 0) await client.indices.delete({ index: stale, ignore_unavailable: true });
  await client.indices.refresh({ index: alias });
  return { indexName, productCount };
}
