import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Text } from '@/components/atoms/Text';
import { SwaggerDocs } from '@/components/organisms/ApiDocs';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';

export const metadata: Metadata = { title: 'API documentation' };

// D49: Swagger UI for every store and admin API (any signed-in staff member).
export default function ApiDocsPage() {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/docs"
        title="API documentation"
        readPermission="catalogue.read"
        writePermission="catalogue.read"
      >
        {() => (
          <Flexbox direction="column" gap="md" align="stretch">
            <Text variant="body3" tone="muted">
              Generated from the route handlers (npm run docs:openapi). Store APIs run on the store
              host; admin APIs on this host.
            </Text>
            <SwaggerDocs />
          </Flexbox>
        )}
      </AdminPageFrame>
    </Suspense>
  );
}
