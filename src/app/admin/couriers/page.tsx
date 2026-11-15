import type { Metadata } from 'next';
import { Suspense } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/atoms/Badge';
import { Card } from '@/components/atoms/Card';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Text } from '@/components/atoms/Text';
import { CourierManager } from '@/components/organisms/OrderAdmin';
import { formatDateTime } from '@/lib/date-format';
import type { StaffContext } from '@/modules/identity/access-control';
import {
  listCourierPartners,
  listServiceablePincodes,
  listWebhookReceipts,
} from '@/modules/fulfilment/courier-admin.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';
import { firstSearchValues } from '../catalogue-page-parts';

export const metadata: Metadata = { title: 'Couriers' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const resultTone = {
  RECEIVED: 'info',
  PROCESSED: 'success',
  DUPLICATE: 'neutral',
  FAILED: 'danger',
} as const;

async function Couriers({
  staff,
  canWrite,
  searchParams,
}: Readonly<{ staff: StaffContext; canWrite: boolean; searchParams: SearchParams }>) {
  const partnerParam = z.uuid().safeParse(firstSearchValues(await searchParams)['partner']);
  const selectedPartnerId = partnerParam.success ? partnerParam.data.toLowerCase() : null;
  const [partners, pincodes, receipts] = await Promise.all([
    listCourierPartners(staff),
    selectedPartnerId === null
      ? Promise.resolve([])
      : listServiceablePincodes(staff, selectedPartnerId),
    listWebhookReceipts(staff, null),
  ]);
  return (
    <Flexbox direction="column" gap="xl" align="stretch">
      <CourierManager
        canWrite={canWrite}
        selectedPartnerId={selectedPartnerId}
        pincodes={pincodes}
        partners={partners.map((partner) => ({
          id: partner.id,
          code: partner.code,
          name: partner.name,
          priority: partner.priority,
          supportsCod: partner.supportsCod,
          isActive: partner.isActive,
          pincodeCount: partner._count.serviceablePincodes,
        }))}
      />
      <Card>
        <Flexbox direction="column" gap="md">
          <Heading level={2} variant="heading4">
            Tracking webhook log
          </Heading>
          <Text variant="body3" tone="muted">
            Signed courier events by courier and event id; a repeated event is never applied twice.
          </Text>
          {receipts.length === 0 ? (
            <Text tone="muted">No courier events yet.</Text>
          ) : (
            <ul aria-label="Webhook events" className="flex flex-col gap-xs">
              {receipts.map((receipt) => (
                <li
                  key={receipt.id}
                  className="flex flex-col gap-xs border-b border-strokes py-sm last:border-b-0 md:flex-row md:items-center md:justify-between"
                >
                  <Text variant="body3">
                    {formatDateTime(receipt.receivedAt)} · {receipt.courierPartner.name} · AWB{' '}
                    {receipt.awbNumber ?? '—'} · {receipt.providerEventId}
                    {receipt.errorMessage === null ? '' : ` · ${receipt.errorMessage}`}
                  </Text>
                  <Badge tone={resultTone[receipt.processingResult]}>
                    {receipt.processingResult.toLowerCase()}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Flexbox>
      </Card>
    </Flexbox>
  );
}

export default function CouriersPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/couriers"
        title="Couriers"
        readPermission="orders.read"
        writePermission="couriers.write"
      >
        {({ staff, canWrite }) => (
          <Couriers staff={staff} canWrite={canWrite} searchParams={searchParams} />
        )}
      </AdminPageFrame>
    </Suspense>
  );
}
