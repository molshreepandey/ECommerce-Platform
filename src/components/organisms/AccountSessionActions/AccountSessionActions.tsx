'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { sendJson } from '@/lib/api-client';

export function AccountSessionActions() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSigningOutEverywhere, setIsSigningOutEverywhere] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function signOut() {
    setIsSigningOut(true);
    const result = await sendJson('/api/store/auth/logout');
    if (result.ok) {
      router.replace('/');
      router.refresh();
      return;
    }
    setIsSigningOut(false);
    setErrorMessage(result.failure.message);
  }

  async function signOutEverywhere() {
    setIsSigningOutEverywhere(true);
    const result = await sendJson('/api/store/auth/logout-all');
    if (result.ok) {
      router.replace('/login');
      router.refresh();
      return;
    }
    setIsSigningOutEverywhere(false);
    setIsConfirmOpen(false);
    setErrorMessage(result.failure.message);
  }

  return (
    <div className="flex flex-col gap-md">
      {errorMessage === null ? null : <InlineAlert tone="danger">{errorMessage}</InlineAlert>}
      <div className="flex flex-wrap gap-sm">
        <Button
          appearance="default"
          iconBefore="log-out"
          isLoading={isSigningOut}
          onClick={() => void signOut()}
        >
          Sign out
        </Button>
        <Button
          appearance="ghost"
          onClick={() => {
            setIsConfirmOpen(true);
          }}
        >
          Sign out of all devices
        </Button>
      </div>
      <ConfirmDialog
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        title="Sign out of all devices?"
        description="You will be signed out here and on every other phone or computer where you are signed in."
        confirmLabel="Sign out everywhere"
        isPending={isSigningOutEverywhere}
        onConfirm={() => void signOutEverywhere()}
      />
    </div>
  );
}
