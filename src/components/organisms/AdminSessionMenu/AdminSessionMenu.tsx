'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { Text } from '@/components/atoms/Text';
import { sendJson } from '@/lib/api-client';

export function AdminSessionMenu({
  fullName,
  roleNames,
}: Readonly<{ fullName: string; roleNames: string }>) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function signOut() {
    setIsSigningOut(true);
    const result = await sendJson('/api/admin/auth/logout');
    if (result.ok) {
      router.replace('/login');
      router.refresh();
      return;
    }
    setIsSigningOut(false);
    setErrorMessage(result.failure.message);
  }

  return (
    <div className="flex flex-wrap items-center gap-md">
      {errorMessage === null ? null : (
        <Text variant="body3" tone="danger">
          {errorMessage}
        </Text>
      )}
      <div className="flex flex-col items-end">
        <Text variant="body2-medium">{fullName}</Text>
        <Text variant="body3" tone="muted">
          {roleNames}
        </Text>
      </div>
      <Button
        appearance="default"
        size="sm"
        iconBefore="log-out"
        isLoading={isSigningOut}
        onClick={() => void signOut()}
      >
        Sign out
      </Button>
    </div>
  );
}
