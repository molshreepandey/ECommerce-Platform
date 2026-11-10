'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { Badge, type BadgeTone } from '@/components/atoms/Badge';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Text } from '@/components/atoms/Text';
import { useToast } from '@/components/atoms/Toast';
import { type ApiFailure, sendJson } from '@/lib/api-client';

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// One place for "call the admin API, toast on success, refresh server data, keep the failure".
export function useCatalogueAction() {
  const router = useRouter();
  const { showToast } = useToast();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  async function run(
    key: string,
    request: { url: string; method: Method; body?: unknown },
    successMessage: string,
  ): Promise<unknown> {
    setPendingKey(key);
    setFailure(null);
    const result = await sendJson(request.url, {
      method: request.method,
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    setPendingKey(null);
    if (!result.ok) {
      setFailure(result.failure);
      return null;
    }
    showToast({ title: successMessage, tone: 'success' });
    router.refresh();
    return result.data ?? {};
  }

  return {
    run,
    pendingKey,
    failure,
    clearFailure: () => {
      setFailure(null);
    },
  };
}

const reasonsSchema = z.object({ reasons: z.array(z.string()) });

function failureHeadline(failure: ApiFailure): string {
  if (failure.status === 403) return 'You do not have permission to make this change.';
  if (failure.status === 0) return failure.message;
  if (failure.status >= 500) return 'Something went wrong on our side. Please try again.';
  return failure.message;
}

// Validation, conflict and not-ready errors show the server's message; activation lists its reasons.
export function ActionFailure({ failure }: Readonly<{ failure: ApiFailure | null }>) {
  if (failure === null) return null;
  const reasons = reasonsSchema.safeParse(failure.details);
  return (
    <InlineAlert tone="danger">
      <span>{failureHeadline(failure)}</span>
      {reasons.success ? (
        <ul className="mt-xs list-disc pl-lg">
          {reasons.data.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </InlineAlert>
  );
}

const statusTones: Record<string, BadgeTone> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  INACTIVE: 'warning',
  ARCHIVED: 'danger',
};

export function StatusBadge({ status }: Readonly<{ status: string }>) {
  return <Badge tone={statusTones[status] ?? 'neutral'}>{status.toLowerCase()}</Badge>;
}

export function ReadOnlyNotice({ canWrite }: Readonly<{ canWrite: boolean }>) {
  if (canWrite) return null;
  return (
    <Text variant="body3" tone="muted">
      You can view the catalogue but not change it.
    </Text>
  );
}
