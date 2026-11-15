'use client';

import { useState } from 'react';
import { z } from 'zod';
import type { OrderStatus, PaymentStatus } from '@/generated/prisma/enums';
import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { SelectField } from '@/components/molecules/SelectField';
import { formatDateTime } from '@/lib/date-format';
import { formatPaise } from '@/lib/money';
import { useAdminAction } from '../AdminActions/use-admin-action';
import { OrderStatusBadge, PaymentStatusBadge } from '../OrderViews/StatusBadges';

export type BulkOrderRow = Readonly<{
  id: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  placedAt: string;
  status: OrderStatus;
  paymentMethod: 'COD' | 'ONLINE';
  paymentStatus: PaymentStatus | null;
  totalPaise: number;
}>;

const actions = [
  { value: 'confirm', label: 'Confirm orders' },
  { value: 'pack', label: 'Mark shipments packed' },
  { value: 'create-awb', label: 'Create AWBs' },
  { value: 'ship', label: 'Hand over to courier' },
] as const;

const resultSchema = z.object({
  results: z.array(
    z.object({
      orderId: z.string(),
      orderNumber: z.string().nullable(),
      isSuccess: z.boolean(),
      message: z.string(),
    }),
  ),
  succeeded: z.number(),
  failed: z.number(),
});

// D38: select orders, run one step on all of them, see what happened to each.
export function OrderBulkList({
  rows,
  canWrite,
}: Readonly<{ rows: readonly BulkOrderRow[]; canWrite: boolean }>) {
  const { run, isPending, failure } = useAdminAction();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [action, setAction] = useState<string>('confirm');
  const [report, setReport] = useState<z.infer<typeof resultSchema> | null>(null);

  function toggle(orderId: string, isChecked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (isChecked) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  async function runBulk() {
    const data = await run(
      { url: '/api/admin/orders/bulk', method: 'POST', body: { action, orderIds: [...selected] } },
      'Bulk action finished',
    );
    const parsed = resultSchema.safeParse(data);
    if (parsed.success) {
      setReport(parsed.data);
      setSelected(new Set());
    }
  }

  return (
    <div className="flex flex-col gap-md">
      {canWrite ? (
        <div className="flex flex-wrap items-end gap-md rounded-default border border-lowlight bg-white p-md">
          <Checkbox
            label="Select all on this page"
            checked={rows.length > 0 && selected.size === rows.length}
            onCheckedChange={(checked) => {
              setSelected(checked === true ? new Set(rows.map(({ id }) => id)) : new Set());
            }}
          />
          <div className="min-w-56">
            <SelectField
              label="Bulk action"
              name="bulkAction"
              options={actions}
              value={action}
              onValueChange={setAction}
            />
          </div>
          <Button
            appearance="primary"
            disabled={selected.size === 0}
            isLoading={isPending}
            onClick={() => void runBulk()}
          >
            Apply to {selected.size} {selected.size === 1 ? 'order' : 'orders'}
          </Button>
        </div>
      ) : null}
      {failure === null ? null : <InlineAlert tone="danger">{failure.message}</InlineAlert>}
      {report === null ? null : (
        <section
          aria-label="Bulk action results"
          className="flex flex-col gap-xs rounded-default border border-lowlight bg-white p-md"
        >
          <Text variant="body2-medium">
            {report.succeeded} succeeded · {report.failed} failed
          </Text>
          <ul className="flex flex-col gap-xs">
            {report.results.map((result) => (
              <li key={result.orderId} className="flex flex-wrap items-center gap-sm">
                <Badge tone={result.isSuccess ? 'success' : 'danger'}>
                  {result.isSuccess ? 'done' : 'failed'}
                </Badge>
                <Text as="span" variant="body3">
                  {result.orderNumber ?? result.orderId}: {result.message}
                </Text>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul aria-label="Orders" className="flex flex-col gap-sm">
        {rows.map((order) => (
          <li
            key={order.id}
            className="flex flex-col gap-xs rounded-default border border-lowlight bg-white p-md md:flex-row md:items-center md:justify-between"
          >
            <div className="flex min-w-0 items-start gap-md">
              {canWrite ? (
                <Checkbox
                  aria-label={`Select ${order.orderNumber}`}
                  checked={selected.has(order.id)}
                  onCheckedChange={(checked) => {
                    toggle(order.id, checked === true);
                  }}
                />
              ) : null}
              <div className="flex min-w-0 flex-col gap-xs">
                <Link href={`/orders/${order.id}`} variant="body2-medium">
                  {order.orderNumber}
                </Link>
                <Text variant="body3" tone="muted">
                  {order.customerName} · {order.customerEmail} · {formatDateTime(order.placedAt)}
                </Text>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-sm">
              <OrderStatusBadge status={order.status} />
              {order.paymentStatus === null ? null : (
                <PaymentStatusBadge
                  status={order.paymentStatus}
                  paymentMethod={order.paymentMethod}
                />
              )}
              <Text variant="body2-medium">{formatPaise(order.totalPaise)}</Text>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
