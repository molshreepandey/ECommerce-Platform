import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Badge } from '@/components/atoms/Badge';
import { Button, ButtonLink } from '@/components/atoms/Button';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { formatDateTime } from '@/lib/date-format';
import { auditListSchema, listAuditEntries } from '@/modules/audit/audit-query.service';
import type { StaffContext } from '@/modules/identity/access-control';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';
import { firstSearchValues } from '../catalogue-page-parts';

export const metadata: Metadata = { title: 'Audit trail' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function describeChange(before: unknown, after: unknown): string {
  const describe = (value: unknown) =>
    typeof value === 'object' && value !== null
      ? Object.entries(value)
          .map(([key, entry]) => `${key}=${String(entry)}`)
          .join(', ')
      : '';
  const beforeText = describe(before);
  const afterText = describe(after);
  if (beforeText === '') return afterText;
  return `${beforeText} → ${afterText}`;
}

async function AuditList({
  staff,
  searchParams,
}: Readonly<{ staff: StaffContext; searchParams: SearchParams }>) {
  const values = firstSearchValues(await searchParams);
  const query = auditListSchema.parse(values);
  const page = await listAuditEntries(staff, query);
  const filterValues = Object.fromEntries(
    Object.entries(values).filter(([key, value]) => key !== 'before' && value !== ''),
  );
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <form
        method="get"
        action="/audit"
        aria-label="Filter audit entries"
        className="grid grid-cols-1 items-end gap-md rounded-default border border-lowlight bg-white p-md md:grid-cols-3 xl:grid-cols-6"
      >
        <FormField
          label="Action starts with"
          name="action"
          defaultValue={query.action ?? ''}
          hint="e.g. order. or inventory.stock"
        />
        <FormField
          label="Entity type"
          name="entityType"
          defaultValue={query.entityType ?? ''}
          hint="e.g. order, customer"
        />
        <FormField label="Entity id" name="entityId" defaultValue={query.entityId ?? ''} />
        <FormField label="Actor id" name="actorId" defaultValue={query.actorId ?? ''} />
        <FormField label="From" name="from" type="date" defaultValue={query.from ?? ''} />
        <FormField label="To" name="to" type="date" defaultValue={query.to ?? ''} />
        <div className="flex gap-sm md:col-span-3 xl:col-span-6">
          <Button type="submit" appearance="primary" iconBefore="search">
            Apply
          </Button>
          <ButtonLink href="/audit" appearance="ghost">
            Clear
          </ButtonLink>
        </div>
      </form>
      {page.items.length === 0 ? (
        <EmptyState
          icon="history"
          headingLevel={2}
          title="No audit entries"
          description="Change the filters to see more."
        />
      ) : (
        <ul aria-label="Audit entries" className="flex flex-col gap-sm">
          {page.items.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-xs rounded-default border border-lowlight bg-white p-md"
            >
              <div className="flex flex-wrap items-center justify-between gap-sm">
                <Text variant="body2-medium">{entry.action}</Text>
                <Badge tone="neutral">{entry.actorType.toLowerCase()}</Badge>
              </div>
              <Text variant="body3" tone="muted">
                {formatDateTime(entry.createdAt)} · {entry.entityType} {entry.entityId}
                {entry.actorId === null ? '' : ` · actor ${entry.actorId}`}
                {entry.ipAddress === null ? '' : ` · IP ${entry.ipAddress}`}
              </Text>
              {entry.before === null && entry.after === null ? null : (
                <Text variant="body3">{describeChange(entry.before, entry.after)}</Text>
              )}
            </li>
          ))}
        </ul>
      )}
      {page.nextBefore === null ? null : (
        <div>
          <ButtonLink
            href={`/audit?${new URLSearchParams({ ...filterValues, before: page.nextBefore }).toString()}`}
          >
            Older entries
          </ButtonLink>
        </div>
      )}
    </Flexbox>
  );
}

export default function AuditPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/audit"
        title="Audit trail"
        readPermission="audit.read"
        writePermission="audit.read"
      >
        {({ staff }) => <AuditList staff={staff} searchParams={searchParams} />}
      </AdminPageFrame>
    </Suspense>
  );
}
