'use client';

import { type SubmitEvent, useState } from 'react';
import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/atoms/EmptyState';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Link } from '@/components/atoms/Link';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import { formatDate } from '@/lib/date-format';
import { formReader } from '@/lib/form-values';
import { formatPaise, paiseToRupeesText, rupeesTextToPaise } from '@/lib/money';
import { useAdminAction } from '../AdminActions/use-admin-action';

export type ReturnQueueItem = Readonly<{
  id: string;
  returnNumber: string;
  requestType: 'RETURN' | 'EXCHANGE';
  status: string;
  reason: string;
  resolutionNote: string | null;
  requestedAt: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  receivingWarehouseName: string | null;
  exchangeOrder: { id: string; orderNumber: string } | null;
  refund: { amountPaise: number; refundMethod: string; reference: string } | null;
  maximumRefundPaise: number;
  items: readonly { label: string; quantity: number; replacementSku: string | null }[];
}>;

type Dialog =
  | { kind: 'approve' | 'reject' | 'refund'; item: ReturnQueueItem }
  | { kind: 'confirm'; item: ReturnQueueItem; action: string; label: string; description: string };

const nextStep: Readonly<
  Record<string, { action: string; label: string; description: string } | undefined>
> = {
  APPROVED: {
    action: 'pick-up',
    label: 'Mark picked up',
    description: 'The courier collected the items from the customer.',
  },
  PICKED_UP: {
    action: 'receive',
    label: 'Mark received',
    description: 'The items arrived at the receiving warehouse.',
  },
  RECEIVED: {
    action: 'restock',
    label: 'Restock items',
    description: 'The returned units are added back to the receiving warehouse stock.',
  },
};

// D43: the returns queue; each request shows only the steps its status allows (the server checks again).
export function ReturnQueue({
  returns,
  warehouses,
  canWrite,
}: Readonly<{
  returns: readonly ReturnQueueItem[];
  warehouses: readonly { id: string; name: string }[];
  canWrite: boolean;
}>) {
  const { run, isPending, failure, clearFailure } = useAdminAction();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [refundMethod, setRefundMethod] = useState('UPI');
  const [formError, setFormError] = useState<string | null>(null);

  async function act(item: ReturnQueueItem, action: string, body: unknown, message: string) {
    const done = await run(
      { url: `/api/admin/returns/${item.id}/${action}`, method: 'POST', body },
      message,
    );
    if (done !== null) setDialog(null);
  }

  async function submitDialog(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog === null || dialog.kind === 'confirm') return;
    const text = formReader(event.currentTarget);
    setFormError(null);
    if (dialog.kind === 'approve') {
      await act(
        dialog.item,
        'decide',
        { decision: 'APPROVE', receivingWarehouseId: warehouseId },
        'Return approved',
      );
    } else if (dialog.kind === 'reject') {
      await act(
        dialog.item,
        'decide',
        { decision: 'REJECT', note: text('note') },
        'Return rejected',
      );
    } else {
      const amountPaise = rupeesTextToPaise(text('amount'));
      if (amountPaise === null) {
        setFormError('Enter the amount in rupees.');
        return;
      }
      await act(
        dialog.item,
        'refund',
        { refundMethod, reference: text('reference'), amountPaise },
        'Refund recorded',
      );
    }
  }

  if (returns.length === 0)
    return <EmptyState icon="undo" headingLevel={2} title="No return requests" />;
  const formTitle =
    dialog?.kind === 'approve'
      ? 'Approve return'
      : dialog?.kind === 'reject'
        ? 'Reject return'
        : 'Record refund';
  return (
    <div className="flex flex-col gap-md">
      {dialog === null && failure !== null ? (
        <InlineAlert tone="danger">{failure.message}</InlineAlert>
      ) : null}
      <ul aria-label="Return requests" className="flex flex-col gap-sm">
        {returns.map((item) => {
          const step = nextStep[item.status];
          return (
            <li
              key={item.id}
              aria-label={item.returnNumber}
              className="flex flex-col gap-sm rounded-default border border-lowlight bg-white p-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-sm">
                <div className="flex flex-col gap-xs">
                  <Text variant="body2-medium">
                    {item.returnNumber} · {item.requestType === 'RETURN' ? 'Return' : 'Exchange'}
                  </Text>
                  <Text variant="body3" tone="muted">
                    <Link href={`/orders/${item.orderId}`} variant="body3">
                      {item.orderNumber}
                    </Link>{' '}
                    · {item.customerName} · {formatDate(item.requestedAt)}
                    {item.receivingWarehouseName === null
                      ? ''
                      : ` · to ${item.receivingWarehouseName}`}
                  </Text>
                </div>
                <Badge
                  tone={
                    item.status === 'REJECTED'
                      ? 'danger'
                      : item.status === 'REFUNDED' || item.status === 'EXCHANGED'
                        ? 'success'
                        : 'info'
                  }
                >
                  {item.status.toLowerCase().replace('_', ' ')}
                </Badge>
              </div>
              <Text variant="body3">Reason: {item.reason}</Text>
              <ul className="flex flex-col">
                {item.items.map((line) => (
                  <li key={line.label}>
                    <Text variant="body3" tone="subtitle">
                      {line.quantity} × {line.label}
                      {line.replacementSku === null ? '' : ` → ${line.replacementSku}`}
                    </Text>
                  </li>
                ))}
              </ul>
              {item.resolutionNote === null ? null : (
                <Text variant="body3" tone="muted">
                  Note: {item.resolutionNote}
                </Text>
              )}
              {item.refund === null ? null : (
                <Text variant="body3" tone="success">
                  Refunded {formatPaise(item.refund.amountPaise)} by{' '}
                  {item.refund.refundMethod.replace('_', ' ').toLowerCase()} · ref{' '}
                  {item.refund.reference}
                </Text>
              )}
              {item.exchangeOrder === null ? null : (
                <Text variant="body3" tone="success">
                  Replacement order{' '}
                  <Link href={`/orders/${item.exchangeOrder.id}`} variant="body3">
                    {item.exchangeOrder.orderNumber}
                  </Link>
                </Text>
              )}
              {canWrite ? (
                <div className="flex flex-wrap gap-sm">
                  {item.status === 'REQUESTED' ? (
                    <>
                      <Button
                        size="sm"
                        appearance="primary"
                        onClick={() => {
                          clearFailure();
                          setDialog({ kind: 'approve', item });
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          clearFailure();
                          setDialog({ kind: 'reject', item });
                        }}
                      >
                        Reject
                      </Button>
                    </>
                  ) : null}
                  {step === undefined ? null : (
                    <Button
                      size="sm"
                      appearance="primary"
                      onClick={() => {
                        clearFailure();
                        setDialog({ kind: 'confirm', item, ...step });
                      }}
                    >
                      {step.label}
                    </Button>
                  )}
                  {item.status === 'RESTOCKED' && item.requestType === 'RETURN' ? (
                    <Button
                      size="sm"
                      appearance="primary"
                      onClick={() => {
                        clearFailure();
                        setDialog({ kind: 'refund', item });
                      }}
                    >
                      Record refund
                    </Button>
                  ) : null}
                  {item.status === 'RESTOCKED' && item.requestType === 'EXCHANGE' ? (
                    <Button
                      size="sm"
                      appearance="primary"
                      onClick={() => {
                        clearFailure();
                        setDialog({
                          kind: 'confirm',
                          item,
                          action: 'exchange',
                          label: 'Create replacement order',
                          description:
                            'A free replacement order is created and its stock reserved.',
                        });
                      }}
                    >
                      Create replacement order
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={dialog?.kind === 'confirm'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={dialog?.kind === 'confirm' ? `${dialog.label}: ${dialog.item.returnNumber}` : ''}
        description={dialog?.kind === 'confirm' ? dialog.description : ''}
        confirmLabel={dialog?.kind === 'confirm' ? dialog.label : 'Confirm'}
        isPending={isPending}
        onConfirm={() => {
          if (dialog?.kind === 'confirm')
            void act(dialog.item, dialog.action, {}, `${dialog.label}: done`);
        }}
      />
      <Modal
        open={dialog !== null && dialog.kind !== 'confirm'}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        title={dialog === null ? '' : `${formTitle} ${dialog.item.returnNumber}`}
        footer={
          <>
            <Button
              onClick={() => {
                setDialog(null);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="return-dialog-form"
              appearance="primary"
              isLoading={isPending}
            >
              Save
            </Button>
          </>
        }
      >
        {formError === null ? null : <InlineAlert tone="danger">{formError}</InlineAlert>}
        {failure === null ? null : <InlineAlert tone="danger">{failure.message}</InlineAlert>}
        <form
          id="return-dialog-form"
          noValidate
          onSubmit={(event) => void submitDialog(event)}
          className="flex flex-col gap-md"
        >
          {dialog?.kind === 'approve' ? (
            <SelectField
              label="Receiving warehouse"
              name="receivingWarehouseId"
              options={warehouses.map((warehouse) => ({
                value: warehouse.id,
                label: warehouse.name,
              }))}
              value={warehouseId}
              onValueChange={setWarehouseId}
            />
          ) : null}
          {dialog?.kind === 'reject' ? (
            <FormField label="Reason for the customer" name="note" maxLength={300} />
          ) : null}
          {dialog?.kind === 'refund' ? (
            <>
              <SelectField
                label="Refund method"
                name="refundMethod"
                options={[
                  { value: 'UPI', label: 'UPI' },
                  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
                ]}
                value={refundMethod}
                onValueChange={setRefundMethod}
              />
              <FormField label="Payment reference" name="reference" maxLength={100} />
              <FormField
                label="Amount (₹)"
                name="amount"
                inputMode="decimal"
                hint={`At most ${formatPaise(dialog.item.maximumRefundPaise)}`}
                defaultValue={paiseToRupeesText(dialog.item.maximumRefundPaise)}
              />
            </>
          ) : null}
        </form>
      </Modal>
    </div>
  );
}
