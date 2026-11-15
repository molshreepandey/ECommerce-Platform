'use client';

import { useState } from 'react';
import type { OrderStatus, ShipmentStatus } from '@/generated/prisma/enums';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Link } from '@/components/atoms/Link';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { SelectField } from '@/components/molecules/SelectField';
import { useAdminAction } from '../AdminActions/use-admin-action';
import { CancelOrderButton } from '../OrderViews/CancelOrderButton';

type ShipmentStep = Readonly<{
  action: string;
  label: string;
  appearance: 'primary' | 'default';
  confirm?: string;
  body?: Record<string, string>;
}>;

// D33 / D36: the steps a shipment can take from its current status (the server enforces the same table).
function stepsFor(status: ShipmentStatus, orderStatus: OrderStatus): ShipmentStep[] {
  switch (status) {
    case 'PENDING':
      return orderStatus === 'CONFIRMED' || orderStatus === 'PROCESSING'
        ? [{ action: 'pack', label: 'Mark packed', appearance: 'primary' }]
        : [];
    case 'PACKED':
      return [{ action: 'create-awb', label: 'Create AWB with courier', appearance: 'primary' }];
    case 'READY_TO_SHIP':
      return [
        { action: 'ship', label: 'Hand over to courier', appearance: 'primary' },
        { action: 'simulate-scan', label: 'Simulate pickup scan', appearance: 'default' },
      ];
    case 'SHIPPED':
      return [
        { action: 'out-for-delivery', label: 'Mark out for delivery', appearance: 'primary' },
        { action: 'simulate-scan', label: 'Simulate next scan', appearance: 'default' },
      ];
    case 'OUT_FOR_DELIVERY':
      return [
        { action: 'deliver', label: 'Mark delivered', appearance: 'primary' },
        {
          action: 'simulate-scan',
          label: 'Simulate delivered scan',
          appearance: 'default',
          body: { outcome: 'DELIVERED' },
        },
        {
          action: 'mark-failed',
          label: 'Mark delivery failed',
          appearance: 'default',
          confirm:
            'Record a failed delivery attempt (NDR)? The courier can re-attempt or return it.',
        },
        {
          action: 'simulate-scan',
          label: 'Simulate failed attempt',
          appearance: 'default',
          body: { outcome: 'DELIVERY_FAILED' },
        },
      ];
    case 'DELIVERY_FAILED':
      return [
        { action: 'reattempt', label: 'Re-attempt delivery', appearance: 'primary' },
        {
          action: 'initiate-rto',
          label: 'Return to origin (RTO)',
          appearance: 'default',
          confirm: 'Send this shipment back to the warehouse? It cannot be delivered after this.',
        },
      ];
    case 'RTO_INITIATED':
      return [
        {
          action: 'receive-rto',
          label: 'Receive at warehouse and restock',
          appearance: 'primary',
          confirm: 'Confirm the parcel is back at the warehouse? Its items are restocked.',
        },
      ];
    case 'AWB_PENDING':
    case 'DELIVERED':
    case 'RTO_RECEIVED':
    case 'CANCELLED':
      return [];
  }
}

export function ShipmentActions({
  shipmentId,
  status,
  orderStatus,
  hasLabel,
  canWrite,
  moveTargets = [],
}: Readonly<{
  shipmentId: string;
  status: ShipmentStatus;
  orderStatus: OrderStatus;
  hasLabel: boolean;
  canWrite: boolean;
  moveTargets?: readonly { id: string; name: string }[];
}>) {
  const { run, isPending, failure } = useAdminAction();
  const [pendingConfirm, setPendingConfirm] = useState<ShipmentStep | null>(null);
  const [moveTo, setMoveTo] = useState<string>(moveTargets[0]?.id ?? '');
  const canMove =
    canWrite && status === 'PENDING' && orderStatus !== 'CANCELLED' && moveTargets.length > 0;
  const steps = canWrite ? stepsFor(status, orderStatus) : [];

  async function perform(step: ShipmentStep) {
    await run(
      {
        url: `/api/admin/shipments/${shipmentId}/${step.action}`,
        method: 'POST',
        body: step.body ?? {},
      },
      `${step.label}: done`,
    );
    setPendingConfirm(null);
  }

  const confirmFirst =
    steps.length === 0 && status === 'PENDING' && canWrite ? (
      <InlineAlert tone="info">Confirm the order before packing this shipment.</InlineAlert>
    ) : null;
  return (
    <div className="flex flex-col gap-sm">
      {failure === null ? null : <InlineAlert tone="danger">{failure.message}</InlineAlert>}
      {confirmFirst}
      <div className="flex flex-wrap items-center gap-sm">
        {steps.map((step) => (
          <Button
            key={`${step.action}-${step.label}`}
            size="sm"
            appearance={step.appearance}
            disabled={isPending}
            onClick={() => {
              if (step.confirm === undefined) void perform(step);
              else setPendingConfirm(step);
            }}
          >
            {step.label}
          </Button>
        ))}
        <Link
          href={`/api/admin/shipments/${shipmentId}/packing-slip`}
          target="_blank"
          rel="noopener"
          variant="body2"
        >
          Packing slip (PDF)
        </Link>
        {hasLabel ? (
          <Link
            href={`/api/admin/shipments/${shipmentId}/label`}
            target="_blank"
            rel="noopener"
            variant="body2"
          >
            Download label (PDF)
          </Link>
        ) : null}
      </div>
      {canMove ? (
        <div className="flex flex-wrap items-end gap-sm">
          <div className="min-w-48">
            <SelectField
              label="Move to warehouse"
              name="moveTo"
              options={moveTargets.map((target) => ({ value: target.id, label: target.name }))}
              value={moveTo}
              onValueChange={setMoveTo}
            />
          </div>
          <Button
            size="sm"
            disabled={isPending || moveTo === ''}
            onClick={() => {
              setPendingConfirm({
                action: 'reallocate',
                label: 'Move shipment',
                appearance: 'default',
                confirm: 'Move this shipment and its reserved stock to the chosen warehouse?',
                body: { warehouseId: moveTo },
              });
            }}
          >
            Move shipment
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null);
        }}
        title={pendingConfirm?.label ?? ''}
        description={pendingConfirm?.confirm ?? ''}
        confirmLabel={pendingConfirm?.label ?? 'Confirm'}
        isPending={isPending}
        onConfirm={() => {
          if (pendingConfirm !== null) void perform(pendingConfirm);
        }}
      />
    </div>
  );
}

export function OrderHeaderActions({
  orderId,
  orderNumber,
  canConfirm,
  canCancel,
  confirmBlockedReason,
}: Readonly<{
  orderId: string;
  orderNumber: string;
  canConfirm: boolean;
  canCancel: boolean;
  confirmBlockedReason: string | null;
}>) {
  const { run, isPending, failure } = useAdminAction();
  return (
    <div className="flex flex-col items-start gap-sm md:items-end">
      <div className="flex flex-wrap gap-sm">
        {canConfirm ? (
          <Button
            appearance="primary"
            iconBefore="check"
            isLoading={isPending}
            onClick={() =>
              void run(
                { url: `/api/admin/orders/${orderId}/confirm`, method: 'POST' },
                'Order confirmed',
              )
            }
          >
            Confirm order
          </Button>
        ) : null}
        {canCancel ? (
          <CancelOrderButton
            cancelUrl={`/api/admin/orders/${orderId}/cancel`}
            orderNumber={orderNumber}
          />
        ) : null}
      </div>
      {confirmBlockedReason === null ? null : (
        <InlineAlert tone="info">{confirmBlockedReason}</InlineAlert>
      )}
      {failure === null ? null : <InlineAlert tone="danger">{failure.message}</InlineAlert>}
    </div>
  );
}
