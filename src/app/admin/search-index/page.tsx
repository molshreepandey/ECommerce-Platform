import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Badge } from '@/components/atoms/Badge';
import { Card } from '@/components/atoms/Card';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Text } from '@/components/atoms/Text';
import { SearchIndexTools } from '@/components/organisms/SearchAdmin';
import { formatDateTime } from '@/lib/date-format';
import { getSearchIndexStatus } from '@/modules/search/search-admin.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';

export const metadata: Metadata = { title: 'Search index' };

export default function SearchIndexPage() {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/search-index"
        title="Search index"
        readPermission="search.manage"
        writePermission="search.manage"
      >
        {async ({ staff, canWrite }) => {
          const status = await getSearchIndexStatus(staff);
          return (
            <Flexbox direction="column" gap="lg" align="stretch">
              <Card as="section" aria-labelledby="index-health">
                <Flexbox direction="column" gap="xs">
                  <Flexbox gap="sm" align="center">
                    <Heading level={2} variant="heading5" id="index-health">
                      Index health
                    </Heading>
                    <Badge tone={status.isElasticsearchReachable ? 'success' : 'danger'}>
                      {status.isElasticsearchReachable ? 'reachable' : 'unreachable'}
                    </Badge>
                  </Flexbox>
                  <Text variant="body3">
                    Elasticsearch: {status.isElasticsearchReachable ? 'reachable' : 'unreachable'}
                  </Text>
                  <Text variant="body3">
                    Alias {status.alias} →{' '}
                    {status.indexNames.length === 0 ? 'no index yet' : status.indexNames.join(', ')}
                  </Text>
                  <Text variant="body3">
                    Documents: {status.documentCount === null ? '—' : String(status.documentCount)}
                  </Text>
                  {status.isElasticsearchReachable ? null : (
                    <Text variant="body3" tone="muted">
                      The store is using the PostgreSQL fallback search until it is back.
                    </Text>
                  )}
                </Flexbox>
              </Card>
              <Card as="section" aria-labelledby="outbox-backlog">
                <Flexbox direction="column" gap="xs">
                  <Heading level={2} variant="heading5" id="outbox-backlog">
                    Outbox backlog
                  </Heading>
                  <Text variant="body2-medium">
                    Queued changes: {String(status.pendingOutboxCount)}
                  </Text>
                  <Text variant="body3" tone="muted">
                    {status.oldestPendingAt === null
                      ? 'Nothing is waiting.'
                      : `Oldest waiting since ${formatDateTime(status.oldestPendingAt)}`}
                  </Text>
                </Flexbox>
              </Card>
              <SearchIndexTools canWrite={canWrite} />
            </Flexbox>
          );
        }}
      </AdminPageFrame>
    </Suspense>
  );
}
