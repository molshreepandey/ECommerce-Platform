'use client';

import { useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { useAdminAction } from '../AdminActions/use-admin-action';

// D48: "Sync now" processes queued changes; "Full reindex" rebuilds the whole index (confirmed first).
export function SearchIndexTools({ canWrite }: Readonly<{ canWrite: boolean }>) {
  const { run, isPending, failure } = useAdminAction();
  const [isConfirming, setIsConfirming] = useState(false);
  if (!canWrite) return null;
  return (
    <div className="flex flex-col gap-sm">
      {failure === null ? null : <InlineAlert tone="danger">{failure.message}</InlineAlert>}
      <div className="flex flex-wrap gap-sm">
        <Button
          appearance="primary"
          isLoading={isPending && !isConfirming}
          onClick={() => {
            void run(
              { url: '/api/admin/search-index/sync', method: 'POST' },
              'Queued changes synced',
            );
          }}
        >
          Sync now
        </Button>
        <Button
          onClick={() => {
            setIsConfirming(true);
          }}
        >
          Full reindex
        </Button>
      </div>
      <ConfirmDialog
        open={isConfirming}
        onOpenChange={setIsConfirming}
        title="Rebuild the whole search index?"
        description="A new index is built and swapped in when ready; search keeps working meanwhile."
        confirmLabel="Full reindex"
        isPending={isPending}
        onConfirm={() => {
          void run(
            { url: '/api/admin/search-index/reindex', method: 'POST' },
            'Search index rebuilt',
          ).then(() => {
            setIsConfirming(false);
          });
        }}
      />
    </div>
  );
}
