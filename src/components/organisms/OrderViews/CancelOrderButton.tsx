'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Modal } from '@/components/atoms/Modal';
import { useToast } from '@/components/atoms/Toast';
import { FormField } from '@/components/molecules/FormField';
import { sendJson } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';

const formId = 'cancel-order-form';

// C34 (customer) and D33 (staff): a destructive action, so it asks for confirmation and a reason.
export function CancelOrderButton({
  cancelUrl,
  orderNumber,
}: Readonly<{ cancelUrl: string; orderNumber: string }>) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = formReader(event.currentTarget)('reason').trim();
    if (reason.length < 3) {
      setReasonError('Tell us why the order is cancelled.');
      return;
    }
    setReasonError(undefined);
    setIsPending(true);
    const result = await sendJson(cancelUrl, { body: { reason } });
    setIsPending(false);
    if (!result.ok) {
      setError(result.failure.message);
      router.refresh();
      return;
    }
    setIsOpen(false);
    showToast({ title: `Order ${orderNumber} cancelled`, tone: 'success' });
    router.refresh();
  }

  return (
    <>
      <Button
        appearance="default"
        iconBefore="close"
        onClick={() => {
          setIsOpen(true);
        }}
      >
        Cancel order
      </Button>
      <Modal
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) setError(null);
        }}
        title={`Cancel order ${orderNumber}?`}
        description="Every item in the order is cancelled and reserved stock is released. This cannot be undone."
        footer={
          <>
            <Button
              onClick={() => {
                setIsOpen(false);
              }}
              disabled={isPending}
            >
              Keep order
            </Button>
            <Button type="submit" form={formId} appearance="primary" isLoading={isPending}>
              Cancel order
            </Button>
          </>
        }
      >
        {error === null ? null : <InlineAlert tone="danger">{error}</InlineAlert>}
        <form id={formId} noValidate onSubmit={(event) => void submit(event)}>
          <FormField label="Reason" name="reason" maxLength={300} error={reasonError} />
        </form>
      </Modal>
    </>
  );
}
