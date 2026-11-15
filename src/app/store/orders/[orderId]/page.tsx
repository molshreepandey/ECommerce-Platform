import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ButtonLink } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Link } from '@/components/atoms/Link';
import { Skeleton } from '@/components/atoms/Skeleton';
import { Text } from '@/components/atoms/Text';
import { CartSummary } from '@/components/organisms/CartPanel';
import {
  CancelOrderButton,
  OrderItemsList,
  OrderStatusBadge,
  PaymentStatusBadge,
  ShipmentTimeline,
} from '@/components/organisms/OrderViews';
import { NotificationLog } from '@/components/organisms/Notifications';
import { ReturnRequestPanel } from '@/components/organisms/Returns';
import { getCustomerOrderNotifications } from '@/modules/notifications/notification-query.service';
import { stars, WriteReviewButton } from '@/components/organisms/Reviews';
import { formatDateTime } from '@/lib/date-format';
import { getOrderReviewStatus } from '@/modules/merchandising/review.service';
import { getReturnOverview } from '@/modules/returns/returns.service';
import { currentCustomerOrRedirect } from '@/modules/identity/current-session';
import { orderCanBeCancelled } from '@/modules/ordering/order-state';
import { orderStatusAppearance } from '@/theme';
import { StorePageFrame } from '../../store-page-frame';
import { loadCustomerOrderOrNotFound, ShippingAddressCard } from '../order-page-parts';

export const metadata: Metadata = { title: 'Order details' };

type PageProps = Readonly<{
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

async function OrderDetails({ params, searchParams }: PageProps) {
  const { orderId } = await params;
  const customer = await currentCustomerOrRedirect(`/orders/${orderId}`);
  const order = await loadCustomerOrderOrNotFound(customer, orderId);
  const justPlaced = (await searchParams)['placed'] === '1';
  const payment = order.payment;
  const awaitingOnlinePayment =
    order.paymentMethod === 'ONLINE' && payment?.status === 'PENDING' && order.status === 'PLACED';
  const [reviewStatus, returnOverview, notifications] = await Promise.all([
    getOrderReviewStatus(customer, order.id),
    getReturnOverview(customer, order.id),
    getCustomerOrderNotifications(customer, order.id),
  ]);
  const itemActions = Object.fromEntries(
    order.items.flatMap((item) => {
      const status = reviewStatus[item.id];
      if (status === undefined) return [];
      if (status.rating !== null) {
        return [
          [
            item.id,
            <Text key={item.id} variant="body3" tone="success">
              You rated it {stars(status.rating)}
            </Text>,
          ],
        ];
      }
      return status.canReview
        ? [
            [
              item.id,
              <div key={item.id}>
                <WriteReviewButton orderItemId={item.id} productName={item.productName} />
              </div>,
            ],
          ]
        : [];
    }),
  );
  const canCancel = orderCanBeCancelled(
    order.status,
    order.shipments.map(({ status }) => status),
  );
  return (
    <Flexbox direction="column" gap="lg">
      {justPlaced && !awaitingOnlinePayment ? (
        <InlineAlert tone="success">
          Thank you! Your order {order.orderNumber} is placed.{' '}
          {order.paymentMethod === 'COD'
            ? 'Pay in cash when it arrives.'
            : 'Your payment was received.'}
        </InlineAlert>
      ) : null}
      {awaitingOnlinePayment ? (
        <InlineAlert tone="warning">
          This order is waiting for payment.{' '}
          <Link href={`/orders/${order.id}/pay`} variant="body2-medium">
            Complete payment
          </Link>
        </InlineAlert>
      ) : null}
      <div className="flex flex-col gap-sm md:flex-row md:items-center md:justify-between">
        <Flexbox direction="column" gap="xs">
          <Link href="/orders" appearance="subtle" variant="body3">
            Your orders
          </Link>
          <Heading level={1} variant="heading2">
            Order {order.orderNumber}
          </Heading>
          <Text variant="body3" tone="muted">
            Placed {formatDateTime(order.placedAt)}
          </Text>
        </Flexbox>
        <div className="flex flex-wrap items-center gap-sm">
          <OrderStatusBadge status={order.status} />
          {payment === null ? null : (
            <PaymentStatusBadge status={payment.status} paymentMethod={order.paymentMethod} />
          )}
          {awaitingOnlinePayment ? (
            <ButtonLink
              href={`/orders/${order.id}/pay`}
              appearance="primary"
              iconBefore="credit-card"
            >
              Pay now
            </ButtonLink>
          ) : null}
          {order.status === 'CANCELLED' ? null : (
            <Link
              href={`/api/store/orders/${order.id}/invoice`}
              target="_blank"
              rel="noopener"
              variant="body2"
            >
              Invoice (PDF)
            </Link>
          )}
          {canCancel ? (
            <CancelOrderButton
              cancelUrl={`/api/store/orders/${order.id}/cancel`}
              orderNumber={order.orderNumber}
            />
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-xl lg:grid-cols-[1fr_22rem]">
        <Flexbox direction="column" gap="lg">
          <Card>
            <OrderItemsList items={order.items} itemActions={itemActions} />
          </Card>
          {order.shipments.map((shipment, index) => (
            <ShipmentTimeline
              key={shipment.id}
              shipment={shipment}
              index={index}
              shipmentCount={order.shipments.length}
            />
          ))}
          <ReturnRequestPanel
            orderId={order.id}
            lines={returnOverview.lines}
            requests={returnOverview.requests.map((request) => ({
              id: request.id,
              returnNumber: request.returnNumber,
              requestType: request.requestType,
              status: request.status,
              requestedAt: request.requestedAt.toISOString(),
              resolutionNote: request.resolutionNote,
              exchangeOrderId: request.exchangeOrderId,
            }))}
          />
          <NotificationLog notifications={notifications} headingId="order-messages" />
          <Card>
            <div className="flex flex-col gap-sm">
              <Heading level={2} variant="heading5">
                Order history
              </Heading>
              <ol className="flex flex-col gap-xs">
                {order.statusHistory.map((entry) => (
                  <li key={entry.id}>
                    <Text variant="body3">
                      {formatDateTime(entry.createdAt)} ·{' '}
                      {orderStatusAppearance[entry.toStatus].label}
                      {entry.reason === null ? '' : ` — ${entry.reason}`}
                    </Text>
                  </li>
                ))}
              </ol>
            </div>
          </Card>
        </Flexbox>
        <Flexbox direction="column" gap="lg">
          <CartSummary
            title="Payment summary"
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
          >
            <Text variant="body3" tone="muted">
              {order.paymentMethod === 'COD'
                ? 'Cash on Delivery'
                : 'Paid online (simulated gateway)'}
            </Text>
          </CartSummary>
          <ShippingAddressCard address={order.shippingAddress} />
        </Flexbox>
      </div>
    </Flexbox>
  );
}

export default function OrderPage(props: PageProps) {
  return (
    <StorePageFrame>
      <Suspense fallback={<Skeleton shape="block" height="lg" />}>
        <OrderDetails {...props} />
      </Suspense>
    </StorePageFrame>
  );
}
