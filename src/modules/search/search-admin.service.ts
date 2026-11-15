import { errors } from '@elastic/elasticsearch';

import { getDatabase } from '@/lib/db';
import { getElasticsearchClient } from '@/lib/elasticsearch';
import { DomainError } from '@/lib/errors';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import {
  assertStaffPermission,
  type RequestMetadata,
  type StaffContext,
} from '@/modules/identity/access-control';

import { reindexAllProducts } from './product-search-index.service';
import { productSearchAlias } from './product-search-index';
import { outboxBacklog } from './search-outbox.repository';
import { drainSearchOutbox, type OutboxDrainResult } from './search-outbox.service';

export interface SearchIndexStatus {
  alias: string;
  isElasticsearchReachable: boolean;
  indexNames: string[];
  documentCount: number | null;
  pendingOutboxCount: number;
  oldestPendingAt: string | null;
}

const searchUnavailable = () =>
  new DomainError({
    kind: 'UNAVAILABLE',
    code: 'SEARCH_UNAVAILABLE',
    message: 'Elasticsearch is not reachable. The store is using the PostgreSQL fallback search.',
  });

function isAlreadyExists(error: unknown): boolean {
  return (
    error instanceof errors.ResponseError &&
    JSON.stringify(error.body).includes('resource_already_exists_exception')
  );
}

function isConnectionFailure(error: unknown): boolean {
  return error instanceof errors.ConnectionError || error instanceof errors.TimeoutError;
}

async function elasticsearchState(alias: string) {
  const client = getElasticsearchClient();
  try {
    if (!(await client.indices.existsAlias({ name: alias }))) {
      return { isElasticsearchReachable: true, indexNames: [], documentCount: 0 };
    }
    const [indices, count] = await Promise.all([
      client.indices.getAlias({ name: alias }),
      client.count({ index: alias }),
    ]);
    return {
      isElasticsearchReachable: true,
      indexNames: Object.keys(indices).sort(),
      documentCount: count.count,
    };
  } catch (error) {
    if (!isConnectionFailure(error)) throw error;
    return { isElasticsearchReachable: false, indexNames: [], documentCount: null };
  }
}

// D48: index health (reachable, indices behind the alias, document count) and the outbox backlog.
export async function getSearchIndexStatus(staff: StaffContext): Promise<SearchIndexStatus> {
  assertStaffPermission(staff, 'search.manage');
  const alias = productSearchAlias();
  const [state, backlog] = await Promise.all([
    elasticsearchState(alias),
    outboxBacklog(getDatabase()),
  ]);
  return {
    alias,
    ...state,
    pendingOutboxCount: backlog.pendingCount,
    oldestPendingAt: backlog.oldestPendingAt?.toISOString() ?? null,
  };
}

async function auditSearchAction(
  staff: StaffContext,
  metadata: RequestMetadata,
  action: 'search.outbox_drained' | 'search.reindexed',
  after: Record<string, string | number | boolean | null>,
) {
  await recordAuditEvent(getDatabase(), {
    actorType: 'STAFF',
    actorId: staff.staffUserId,
    action,
    entityType: 'search_index',
    entityId: productSearchAlias(),
    after,
    ipAddress: metadata.clientIp,
    requestId: metadata.requestId,
  });
}

// "Sync now": processes the queued changes at once instead of waiting for the next admin change.
export async function syncSearchIndexNow(
  staff: StaffContext,
  metadata: RequestMetadata,
): Promise<OutboxDrainResult> {
  assertStaffPermission(staff, 'search.manage');
  try {
    const result = await drainSearchOutbox();
    await auditSearchAction(staff, metadata, 'search.outbox_drained', { ...result });
    return result;
  } catch (error) {
    if (isConnectionFailure(error)) throw searchUnavailable();
    throw error;
  }
}

// Full rebuild into a new versioned index with an alias swap (zero downtime). A second rebuild started
// meanwhile fails to create the same index name and is answered 409.
export async function reindexSearchNow(
  staff: StaffContext,
  metadata: RequestMetadata,
): Promise<{ indexName: string; productCount: number }> {
  assertStaffPermission(staff, 'search.manage');
  try {
    const result = await reindexAllProducts();
    await auditSearchAction(staff, metadata, 'search.reindexed', { ...result });
    return result;
  } catch (error) {
    if (isConnectionFailure(error)) throw searchUnavailable();
    if (isAlreadyExists(error)) {
      throw new DomainError({
        kind: 'CONFLICT',
        code: 'REINDEX_RUNNING',
        message: 'A full reindex is already running. Try again when it finishes.',
      });
    }
    throw error;
  }
}
