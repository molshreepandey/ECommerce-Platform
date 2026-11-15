import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ButtonLink } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Link } from '@/components/atoms/Link';
import { Skeleton } from '@/components/atoms/Skeleton';
import { Text } from '@/components/atoms/Text';
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/organisms/OrderViews';
import { formatDate } from '@/lib/date-format';
import { formatPaise } from '@/lib/money';
import { currentCustomerOrRedirect } from '@/modules/identity/current-session';
import {
  customerOrderListSchema,
  listCustomerOrders,
  orderStatuses,
} from '@/modules/ordering/order-query.service';
import { orderStatusAppearance } from '@/theme';
import { StorePageFrame } from '../store-page-frame';

export const metadata: Metadata = { title: 'Your orders' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function OrderList({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const customer = await currentCustomerOrRedirect('/orders');
  const params = await searchParams;
  const query = customerOrderListSchema.parse({
    status: first(params['status']),
    cursor: first(params['cursor']),
  });
  const page = await listCustomerOrders(customer, query);
  const statusQuery = query.status === undefined ? '' : `status=${query.status}&`;
  return (
    <Flexbox direction="column" gap="lg">
      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-sm">
          <li>
            <Link
              href="/orders"
              appearance={query.status === undefined ? 'default' : 'subtle'}
              aria-current={query.status === undefined ? 'true' : undefined}
            >
              All
            </Link>
          </li>
          {orderStatuses.map((status) => (
            <li key={status}>
              <Link
                href={`/orders?status=${status}`}
                appearance={query.status === status ? 'default' : 'subtle'}
                aria-current={query.status === status ? 'true' : undefined}
              >
                {orderStatusAppearance[status].label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {page.items.length === 0 ? (
        <EmptyState
          icon="package"
          headingLevel={2}
          title={query.status === undefined ? 'No orders yet' : 'No orders with this status'}
          description="Orders you place appear here with their delivery status."
          action={
            <ButtonLink href="/search" appearance="primary">
              Start shopping
            </ButtonLink>
          }
        />
      ) : (
        <ul aria-label="Orders" className="flex flex-col gap-md">
          {page.items.map((order) => (
            <Card as="li" key={order.id}>
              <div className="flex flex-col gap-sm md:flex-row md:items-center md:justify-between">
                <div className="flex flex-col gap-xs">
                  <Link href={`/orders/${order.id}`} variant="body1-medium">
                    {order.orderNumber}
                  </Link>
                  <Text variant="body3" tone="muted">
                    Placed {formatDate(order.placedAt)} · {order._count.items}{' '}
                    {order._count.items === 1 ? 'item' : 'items'}
                  </Text>
                </div>
                <div className="flex flex-wrap items-center gap-sm">
                  <OrderStatusBadge status={order.status} />
                  {order.payment === null ? null : (
                    <PaymentStatusBadge
                      status={order.payment.status}
                      paymentMethod={order.paymentMethod}
                    />
                  )}
                  <Text variant="body2-medium">{formatPaise(order.totalPaise)}</Text>
                </div>
              </div>
            </Card>
          ))}
        </ul>
      )}
      {page.nextCursor === null ? null : (
        <div>
          <ButtonLink href={`/orders?${statusQuery}cursor=${page.nextCursor}`}>
            Older orders
          </ButtonLink>
        </div>
      )}
    </Flexbox>
  );
}

export default function OrdersPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  return (
    <StorePageFrame>
      <Flexbox direction="column" gap="xl">
        <Heading level={1} variant="heading2">
          Your orders
        </Heading>
        <Suspense fallback={<Skeleton shape="block" height="lg" />}>
          <OrderList searchParams={searchParams} />
        </Suspense>
      </Flexbox>
    </StorePageFrame>
  );
}
