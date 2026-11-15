import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Link } from '@/components/atoms/Link';
import { ReturnQueue } from '@/components/organisms/Returns';
import type { StaffContext } from '@/modules/identity/access-control';
import { listManifestWarehouses } from '@/modules/ordering/order-documents.service';
import { listReturns, maximumRefundPaise } from '@/modules/returns/return-admin.service';
import { returnListSchema } from '@/modules/returns/returns.schema';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';
import { firstSearchValues } from '../catalogue-page-parts';

export const metadata: Metadata = { title: 'Returns' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const filters = [
  'REQUESTED',
  'APPROVED',
  'PICKED_UP',
  'RECEIVED',
  'RESTOCKED',
  'REFUNDED',
  'EXCHANGED',
  'REJECTED',
] as const;

async function Returns({
  staff,
  canWrite,
  searchParams,
}: Readonly<{ staff: StaffContext; canWrite: boolean; searchParams: SearchParams }>) {
  const { status } = returnListSchema.parse(firstSearchValues(await searchParams));
  const [returns, warehouses] = await Promise.all([
    listReturns(staff, status ?? null),
    listManifestWarehouses(staff),
  ]);
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <nav aria-label="Filter by status">
        <ul className="flex flex-wrap gap-sm">
          <li>
            <Link href="/returns" appearance={status === undefined ? 'default' : 'subtle'}>
              All
            </Link>
          </li>
          {filters.map((filter) => (
            <li key={filter}>
              <Link
                href={`/returns?status=${filter}`}
                appearance={status === filter ? 'default' : 'subtle'}
              >
                {filter.toLowerCase().replace('_', ' ')}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <ReturnQueue
        canWrite={canWrite}
        warehouses={warehouses.map(({ id, name }) => ({ id, name }))}
        returns={returns.map((item) => ({
          id: item.id,
          returnNumber: item.returnNumber,
          requestType: item.requestType,
          status: item.status,
          reason: item.reason,
          resolutionNote: item.resolutionNote,
          requestedAt: item.requestedAt.toISOString(),
          orderId: item.orderId,
          orderNumber: item.order.orderNumber,
          customerName: item.customer.fullName,
          receivingWarehouseName: item.receivingWarehouse?.name ?? null,
          exchangeOrder: item.exchangeOrder,
          refund:
            item.refund === null
              ? null
              : {
                  amountPaise: item.refund.amountPaise,
                  refundMethod: item.refund.refundMethod,
                  reference: item.refund.reference,
                },
          maximumRefundPaise: maximumRefundPaise(item),
          items: item.items.map((line) => ({
            label: `${line.orderItem.productName} (${line.orderItem.sku})`,
            quantity: line.quantity,
            replacementSku: line.exchangeVariant?.sku ?? null,
          })),
        }))}
      />
    </Flexbox>
  );
}

export default function ReturnsPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/returns"
        title="Returns"
        readPermission="orders.read"
        writePermission="returns.write"
      >
        {({ staff, canWrite }) => (
          <Returns staff={staff} canWrite={canWrite} searchParams={searchParams} />
        )}
      </AdminPageFrame>
    </Suspense>
  );
}
