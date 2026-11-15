import type { Metadata } from 'next';
import { Suspense } from 'react';
import { z } from 'zod';
import { Card } from '@/components/atoms/Card';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { CartSummary } from '@/components/organisms/CartPanel';
import { OrderHeaderActions, ShipmentActions } from '@/components/organisms/OrderAdmin';
import { NotificationLog } from '@/components/organisms/Notifications';
import {
  OrderItemsList,
  OrderStatusBadge,
  PaymentStatusBadge,
  ShipmentTimeline,
  ShippingAddressCard,
} from '@/components/organisms/OrderViews';
import { formatDateTime } from '@/lib/date-format';
import { isNotFoundError } from '@/lib/errors';
import { formatPaise } from '@/lib/money';
import type { StaffContext } from '@/modules/identity/access-control';
import { listManifestWarehouses } from '@/modules/ordering/order-documents.service';
import { getStaffOrder } from '@/modules/ordering/order-query.service';
import { getStaffOrderNotifications } from '@/modules/notifications/notification-query.service';
import { canMoveOrder, orderCanBeCancelled } from '@/modules/ordering/order-state';
import { orderStatusAppearance } from '@/theme';
import { AdminPageFrame, AdminPageLoading } from '../../admin-page-frame';
import { BackLink, CatalogueNotFound } from '../../catalogue-page-parts';

export const metadata: Metadata = { title: 'Order' };

async function loadOrder(staff: StaffContext, orderId: string) {
  if (!z.uuid().safeParse(orderId).success) return null;
  try {
    return await getStaffOrder(staff, orderId);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

function auditSummary(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  return Object.entries(value)
    .map(([key, entry]) => `${key}: ${String(entry)}`)
    .join(', ');
}

async function OrderWorkspace({
  staff,
  canWrite,
  orderId,
}: Readonly<{ staff: StaffContext; canWrite: boolean; orderId: string }>) {
  const loaded = await loadOrder(staff, orderId);
  if (loaded === null)
    return <CatalogueNotFound what="order" backHref="/orders" backLabel="All orders" />;
  const { order, auditEntries } = loaded;
  const [warehouses, notifications] = await Promise.all([
    listManifestWarehouses(staff),
    getStaffOrderNotifications(staff, order.id),
  ]);
  const payment = order.payment;
  const onlineUnpaid = order.paymentMethod === 'ONLINE' && payment?.status !== 'COLLECTED';
  const canConfirm = canWrite && canMoveOrder(order.status, 'CONFIRMED') && !onlineUnpaid;
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <BackLink href="/orders" label="All orders" />
      <div className="flex flex-col gap-md md:flex-row md:items-start md:justify-between">
        <Flexbox direction="column" gap="xs">
          <Heading level={2} variant="heading3">
            {order.orderNumber}
          </Heading>
          <Text variant="body3" tone="muted">
            Placed {formatDateTime(order.placedAt)} by {order.customer.fullName} (
            {order.customer.email}, {order.customer.phone})
          </Text>
          <div className="flex flex-wrap items-center gap-sm">
            <OrderStatusBadge status={order.status} />
            {payment === null ? null : (
              <PaymentStatusBadge status={payment.status} paymentMethod={order.paymentMethod} />
            )}
            {order.status === 'CANCELLED' ? null : (
              <Link
                href={`/api/admin/orders/${order.id}/invoice`}
                target="_blank"
                rel="noopener"
                variant="body3"
              >
                Invoice (PDF)
              </Link>
            )}
          </div>
        </Flexbox>
        {canWrite ? (
          <OrderHeaderActions
            orderId={order.id}
            orderNumber={order.orderNumber}
            canConfirm={canConfirm}
            canCancel={orderCanBeCancelled(
              order.status,
              order.shipments.map(({ status }) => status),
            )}
            confirmBlockedReason={
              order.status === 'PLACED' && onlineUnpaid
                ? 'Waiting for the online payment before confirming.'
                : null
            }
          />
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-lg xl:grid-cols-[1fr_22rem]">
        <Flexbox direction="column" gap="lg">
          <Card>
            <OrderItemsList items={order.items} linkToProduct={false} />
          </Card>
          {order.shipments.map((shipment, index) => (
            <ShipmentTimeline
              key={shipment.id}
              shipment={shipment}
              index={index}
              shipmentCount={order.shipments.length}
              showWarehouse
            >
              <ShipmentActions
                shipmentId={shipment.id}
                status={shipment.status}
                orderStatus={order.status}
                hasLabel={shipment.labelUrl !== null}
                canWrite={canWrite}
                moveTargets={warehouses.filter(({ id }) => id !== shipment.warehouse.id)}
              />
            </ShipmentTimeline>
          ))}
          <NotificationLog
            notifications={notifications}
            headingId="order-messages"
            headingLevel={3}
          />
          <Card>
            <Flexbox direction="column" gap="sm">
              <Heading level={3} variant="heading5">
                Status history
              </Heading>
              <ol className="flex flex-col gap-xs">
                {order.statusHistory.map((entry) => (
                  <li key={entry.id}>
                    <Text variant="body3">
                      {formatDateTime(entry.createdAt)} ·{' '}
                      {entry.fromStatus === null
                        ? 'new'
                        : orderStatusAppearance[entry.fromStatus].label}{' '}
                      → {orderStatusAppearance[entry.toStatus].label} · by{' '}
                      {entry.actorType.toLowerCase()}
                      {entry.reason === null ? '' : ` — ${entry.reason}`}
                    </Text>
                  </li>
                ))}
              </ol>
            </Flexbox>
          </Card>
          <Card>
            <Flexbox direction="column" gap="sm">
              <Heading level={3} variant="heading5">
                Audit
              </Heading>
              {auditEntries.length === 0 ? (
                <Text variant="body3" tone="muted">
                  No audit entries.
                </Text>
              ) : (
                <ol className="flex flex-col gap-xs">
                  {auditEntries.map((entry) => (
                    <li key={entry.id}>
                      <Text variant="body3">
                        {formatDateTime(entry.createdAt)} · {entry.action} ·{' '}
                        {entry.actorType.toLowerCase()}
                        {entry.after === null ? '' : ` · ${auditSummary(entry.after)}`}
                      </Text>
                    </li>
                  ))}
                </ol>
              )}
              <Link href={`/audit?entityType=order&entityId=${order.id}`} variant="body3">
                Open in audit trail
              </Link>
            </Flexbox>
          </Card>
        </Flexbox>
        <Flexbox direction="column" gap="lg">
          <CartSummary
            title="Amounts"
            codFeeNote={false}
            cart={{
              subtotalPaise: order.subtotalPaise,
              discountPaise: order.discountPaise,
              taxPaise: order.taxPaise,
              shippingFeePaise: order.shippingFeePaise,
              codFeePaise: order.codFeePaise,
              totalPaise: order.totalPaise,
              couponCode: order.couponCode,
            }}
          />
          {payment === null ? null : (
            <Card>
              <Flexbox direction="column" gap="xs">
                <Heading level={3} variant="heading5">
                  Payment
                </Heading>
                <Text variant="body3">
                  {order.paymentMethod === 'COD'
                    ? 'Cash on Delivery'
                    : 'Online (simulated gateway)'}{' '}
                  · {formatPaise(payment.amountPaise)}
                </Text>
                {payment.collectedAt === null ? null : (
                  <Text variant="body3">Collected {formatDateTime(payment.collectedAt)}</Text>
                )}
                {payment.failedAt === null ? null : (
                  <Text variant="body3" tone="danger">
                    Failed {formatDateTime(payment.failedAt)}
                  </Text>
                )}
                {payment.voidedAt === null ? null : (
                  <Text variant="body3">Voided {formatDateTime(payment.voidedAt)}</Text>
                )}
                {payment.attempts.map((attempt) => (
                  <Text key={attempt.id} variant="body3" tone="muted">
                    {formatDateTime(attempt.createdAt)} · {attempt.outcome.toLowerCase()}
                    {attempt.declineCode === null ? '' : ` (${attempt.declineCode})`} ·{' '}
                    {attempt.providerReference}
                  </Text>
                ))}
              </Flexbox>
            </Card>
          )}
          <ShippingAddressCard address={order.shippingAddress} />
        </Flexbox>
      </div>
    </Flexbox>
  );
}

export default function OrderPage({ params }: Readonly<{ params: Promise<{ orderId: string }> }>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/orders"
        title="Order"
        readPermission="orders.read"
        writePermission="orders.write"
      >
        {async ({ staff, canWrite }) => (
          <OrderWorkspace staff={staff} canWrite={canWrite} orderId={(await params).orderId} />
        )}
      </AdminPageFrame>
    </Suspense>
  );
}
