import type { Metadata } from 'next';
import { after } from 'next/server';
import { Suspense } from 'react';
import { Button, ButtonLink } from '@/components/atoms/Button';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Select } from '@/components/atoms/Select';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { OrderBulkList } from '@/components/organisms/OrderAdmin';
import type { StaffContext } from '@/modules/identity/access-control';
import {
  listStaffOrders,
  orderStatuses,
  staffOrderListSchema,
} from '@/modules/ordering/order-query.service';
import { expireUnpaidOnlineOrders } from '@/modules/payment/payment.service';
import { orderStatusAppearance } from '@/theme';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';
import { firstSearchValues } from '../catalogue-page-parts';

export const metadata: Metadata = { title: 'Orders' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function OrderList({
  staff,
  canWrite,
  searchParams,
}: Readonly<{ staff: StaffContext; canWrite: boolean; searchParams: SearchParams }>) {
  const values = firstSearchValues(await searchParams);
  const query = staffOrderListSchema.parse(values);
  after(() => expireUnpaidOnlineOrders({ requestId: crypto.randomUUID() }));
  const page = await listStaffOrders(staff, query);
  const filterValues = Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => key !== 'cursor' && value !== '' && value !== 'ALL',
    ),
  );
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <form
        method="get"
        action="/orders"
        aria-label="Filter orders"
        className="grid grid-cols-1 items-end gap-md rounded-default border border-lowlight bg-white p-md md:grid-cols-6"
      >
        <div className="md:col-span-2">
          <FormField
            label="Search"
            name="q"
            defaultValue={query.q ?? ''}
            hint="Order number, email, phone or AWB"
          />
        </div>
        <label className="flex flex-col gap-xs">
          <Text as="span" variant="body2-medium">
            Status
          </Text>
          <Select
            name="status"
            aria-label="Status"
            defaultValue={query.status ?? 'ALL'}
            options={[
              { value: 'ALL', label: 'Any status' },
              ...orderStatuses.map((status) => ({
                value: status,
                label: orderStatusAppearance[status].label,
              })),
            ]}
          />
        </label>
        <label className="flex flex-col gap-xs">
          <Text as="span" variant="body2-medium">
            Payment
          </Text>
          <Select
            name="paymentMethod"
            aria-label="Payment method"
            defaultValue={query.paymentMethod ?? 'ALL'}
            options={[
              { value: 'ALL', label: 'Any method' },
              { value: 'COD', label: 'Cash on Delivery' },
              { value: 'ONLINE', label: 'Online' },
            ]}
          />
        </label>
        <FormField label="From" name="from" type="date" defaultValue={query.from ?? ''} />
        <FormField label="To" name="to" type="date" defaultValue={query.to ?? ''} />
        <div className="flex gap-sm md:col-span-6">
          <Button type="submit" appearance="primary" iconBefore="search">
            Apply
          </Button>
          <ButtonLink href="/orders" appearance="ghost">
            Clear
          </ButtonLink>
        </div>
      </form>
      {page.items.length === 0 ? (
        <EmptyState
          icon="clipboard-list"
          headingLevel={2}
          title="No orders found"
          description="Change the filters to see more orders."
        />
      ) : (
        <OrderBulkList
          canWrite={canWrite}
          rows={page.items.map((order) => ({
            id: order.id,
            orderNumber: order.orderNumber,
            customerName: order.customer.fullName,
            customerEmail: order.customer.email,
            placedAt: order.placedAt.toISOString(),
            status: order.status,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.payment?.status ?? null,
            totalPaise: order.totalPaise,
          }))}
        />
      )}
      {page.nextCursor === null ? null : (
        <div>
          <ButtonLink
            href={`/orders?${new URLSearchParams({ ...filterValues, cursor: page.nextCursor }).toString()}`}
          >
            Next page
          </ButtonLink>
        </div>
      )}
    </Flexbox>
  );
}

export default function OrdersPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/orders"
        title="Orders"
        readPermission="orders.read"
        writePermission="orders.write"
      >
        {({ staff, canWrite }) => (
          <OrderList staff={staff} canWrite={canWrite} searchParams={searchParams} />
        )}
      </AdminPageFrame>
    </Suspense>
  );
}
