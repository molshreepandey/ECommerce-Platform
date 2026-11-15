'use client';

import { type SubmitEvent, useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Modal } from '@/components/atoms/Modal';
import { FormField } from '@/components/molecules/FormField';
import { formReader } from '@/lib/form-values';
import { useAdminAction } from '../AdminActions/use-admin-action';

const formId = 'customer-status-form';

// D44: blocking signs the customer out everywhere and stops sign-in and checkout; it asks for a reason.
export function CustomerStatusButton({
  customerId,
  customerName,
  isBlocked,
}: Readonly<{ customerId: string; customerName: string; isBlocked: boolean }>) {
  const { run, isPending, failure, clearFailure } = useAdminAction();
  const [isOpen, setIsOpen] = useState(false);
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = formReader(event.currentTarget)('reason').trim();
    if (reason.length < 3) {
      setReasonError('Give a reason.');
      return;
    }
    setReasonError(undefined);
    const saved = await run(
      {
        url: `/api/admin/customers/${customerId}/status`,
        method: 'POST',
        body: { isBlocked: !isBlocked, reason },
      },
      isBlocked ? 'Customer unblocked' : 'Customer blocked',
    );
    if (saved !== null) setIsOpen(false);
  }

  const action = isBlocked ? 'Unblock' : 'Block';
  return (
    <>
      <Button
        appearance={isBlocked ? 'default' : 'primary'}
        iconBefore={isBlocked ? 'restore' : 'close'}
        onClick={() => {
          clearFailure();
          setIsOpen(true);
        }}
      >
        {action} customer
      </Button>
      <Modal
        open={isOpen}
        onOpenChange={setIsOpen}
        title={`${action} ${customerName}?`}
        description={
          isBlocked
            ? 'The customer can sign in and place orders again.'
            : 'The customer is signed out everywhere and cannot sign in or place orders until unblocked.'
        }
        footer={
          <>
            <Button
              onClick={() => {
                setIsOpen(false);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" form={formId} appearance="primary" isLoading={isPending}>
              {action}
            </Button>
          </>
        }
      >
        {failure === null ? null : <InlineAlert tone="danger">{failure.message}</InlineAlert>}
        <form id={formId} noValidate onSubmit={(event) => void submit(event)}>
          <FormField label="Reason" name="reason" maxLength={300} error={reasonError} />
        </form>
      </Modal>
    </>
  );
}
