'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/atoms/Toast';
import { type ApiFailure, sendJson } from '@/lib/api-client';

type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// A failure that leaves the outcome unknown (network error, 5xx other than a rolled-back timeout).
export function outcomeIsUnknown(failure: ApiFailure): boolean {
  return failure.status === 0 || (failure.status >= 500 && failure.code !== 'TRANSACTION_TIMEOUT');
}

// Calls an admin API, toasts on success and refreshes the server-rendered data. A failure with an unknown
// outcome, or one of `refreshOnFailureCodes`, refreshes too so the page shows what was actually saved.
export function useAdminAction(options: { refreshOnFailureCodes?: readonly string[] } = {}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, setIsPending] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  async function run(
    request: { url: string; method: Method; body?: unknown; idempotencyKey?: string },
    successMessage: string,
  ): Promise<unknown> {
    setIsPending(true);
    setFailure(null);
    const result = await sendJson(request.url, {
      method: request.method,
      ...(request.body === undefined ? {} : { body: request.body }),
      ...(request.idempotencyKey === undefined
        ? {}
        : { headers: { 'Idempotency-Key': request.idempotencyKey } }),
    });
    setIsPending(false);
    if (!result.ok) {
      setFailure(result.failure);
      if (
        outcomeIsUnknown(result.failure) ||
        (options.refreshOnFailureCodes ?? []).includes(result.failure.code)
      ) {
        router.refresh();
      }
      return null;
    }
    showToast({ title: successMessage, tone: 'success' });
    router.refresh();
    return result.data ?? {};
  }

  return {
    run,
    isPending,
    failure,
    clearFailure: () => {
      setFailure(null);
    },
  };
}
