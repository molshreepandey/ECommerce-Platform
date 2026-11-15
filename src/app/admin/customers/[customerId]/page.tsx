import type { Metadata } from 'next';
import { Suspense } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/atoms/Badge';
import { Card } from '@/components/atoms/Card';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Grid } from '@/components/atoms/Grid';
import { Heading } from '@/components/atoms/Heading';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { CustomerStatusButton } from '@/components/organisms/CustomerAdmin';
import { OrderStatusBadge } from '@/components/organisms/OrderViews';
import { formatDate, formatDateTime } from '@/lib/date-format';
import { isNotFoundError } from '@/lib/errors';
import { formatPaise } from '@/lib/money';
import type { StaffContext } from '@/modules/identity/access-control';
import { getCustomerDetail } from '@/modules/identity/customer-admin.service';
import { AdminPageFrame, AdminPageLoading } from '../../admin-page-frame';
import { BackLink, CatalogueNotFound } from '../../catalogue-page-parts';

export const metadata: Metadata = { title: 'Customer' };

async function loadCustomer(staff: StaffContext, customerId: string) {
  if (!z.uuid().safeParse(customerId).success) return null;
  try {
    return await getCustomerDetail(staff, customerId.toLowerCase());
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function CustomerWorkspace({
  staff,
  canBlock,
  customerId,
}: Readonly<{ staff: StaffContext; canBlock: boolean; customerId: string }>) {
  const detail = await loadCustomer(staff, customerId);
  if (detail === null)
    return <CatalogueNotFound what="customer" backHref="/customers" backLabel="All customers" />;
  const { customer, stats, recentOrders } = detail;
  const figures = [
    { label: 'Orders', value: String(stats.orderCount) },
    { label: 'Lifetime value', value: formatPaise(stats.lifetimeValuePaise) },
    { label: 'Cancelled', value: String(stats.cancelledCount) },
    { label: 'Returned to origin', value: String(stats.rtoCount) },
  ];
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <BackLink href="/customers" label="All customers" />
      <div className="flex flex-col gap-md md:flex-row md:items-start md:justify-between">
        <Flexbox direction="column" gap="xs">
          <Heading level={2} variant="heading3">
            {customer.fullName}
          </Heading>
          <Text variant="body3" tone="muted">
            {customer.email} · {customer.phone} · joined {formatDate(customer.createdAt)}
          </Text>
          <div>
            <Badge tone={customer.status === 'ACTIVE' ? 'success' : 'danger'}>
              {customer.status === 'ACTIVE'
                ? 'active'
                : `blocked${customer.blockedAt === null ? '' : ` since ${formatDateTime(customer.blockedAt)}`}`}
            </Badge>
          </div>
        </Flexbox>
        {canBlock ? (
          <CustomerStatusButton
            customerId={customer.id}
            customerName={customer.fullName}
            isBlocked={customer.status === 'BLOCKED'}
          />
        ) : null}
      </div>
      <Grid columns={4} gap="md" as="ul" aria-label="Customer figures">
        {figures.map((figure) => (
          <Card as="li" key={figure.label}>
            <Flexbox direction="column" gap="xs">
              <Text variant="body3-medium" tone="muted">
                {figure.label}
              </Text>
              <Heading level={3} variant="heading2-5">
                {figure.value}
              </Heading>
            </Flexbox>
          </Card>
        ))}
      </Grid>
      <div className="grid grid-cols-1 gap-lg xl:grid-cols-2">
        <Card as="section">
          <Flexbox direction="column" gap="sm">
            <Heading level={3} variant="heading5">
              Recent orders
            </Heading>
            {recentOrders.length === 0 ? (
              <Text tone="muted">No orders yet.</Text>
            ) : (
              <ul className="flex flex-col gap-xs">
                {recentOrders.map((order) => (
                  <li
                    key={order.id}
                    className="flex flex-wrap items-center justify-between gap-sm border-b border-strokes py-xs last:border-b-0"
                  >
                    <Link href={`/orders/${order.id}`} variant="body2">
                      {order.orderNumber}
                    </Link>
                    <span className="flex items-center gap-sm">
                      <OrderStatusBadge status={order.status} />
                      <Text as="span" variant="body3">
                        {formatPaise(order.totalPaise)}
                      </Text>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Flexbox>
        </Card>
        <Card as="section">
          <Flexbox direction="column" gap="sm">
            <Heading level={3} variant="heading5">
              Addresses
            </Heading>
            {customer.addresses.length === 0 ? (
              <Text tone="muted">No saved addresses.</Text>
            ) : (
              <ul className="flex flex-col gap-xs">
                {customer.addresses.map((address) => (
                  <li key={address.id}>
                    <Text variant="body3">
                      {address.recipientName} · {address.addressLine1}, {address.city},{' '}
                      {address.state} {address.pincode}
                      {address.isDefault ? ' · default' : ''}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/audit?entityType=customer&entityId=${customer.id}`} variant="body3">
              Audit history
            </Link>
          </Flexbox>
        </Card>
      </div>
    </Flexbox>
  );
}

export default function CustomerPage({
  params,
}: Readonly<{ params: Promise<{ customerId: string }> }>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/customers"
        title="Customer"
        readPermission="customers.read"
        writePermission="customers.block"
      >
        {async ({ staff, canWrite }) => (
          <CustomerWorkspace
            staff={staff}
            canBlock={canWrite}
            customerId={(await params).customerId}
          />
        )}
      </AdminPageFrame>
    </Suspense>
  );
}
