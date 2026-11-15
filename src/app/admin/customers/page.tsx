import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Badge } from '@/components/atoms/Badge';
import { Button, ButtonLink } from '@/components/atoms/Button';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Link } from '@/components/atoms/Link';
import { Select } from '@/components/atoms/Select';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { formatDate } from '@/lib/date-format';
import type { StaffContext } from '@/modules/identity/access-control';
import { customerListSchema, listCustomers } from '@/modules/identity/customer-admin.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';
import { firstSearchValues } from '../catalogue-page-parts';

export const metadata: Metadata = { title: 'Customers' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function CustomerList({
  staff,
  searchParams,
}: Readonly<{ staff: StaffContext; searchParams: SearchParams }>) {
  const values = firstSearchValues(await searchParams);
  const query = customerListSchema.parse(values);
  const page = await listCustomers(staff, query);
  const filterValues = Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => key !== 'cursor' && value !== '' && value !== 'ALL',
    ),
  );
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <form
        method="get"
        action="/customers"
        aria-label="Filter customers"
        className="grid grid-cols-1 items-end gap-md rounded-default border border-lowlight bg-white p-md md:grid-cols-4"
      >
        <div className="md:col-span-2">
          <FormField
            label="Search"
            name="q"
            defaultValue={query.q ?? ''}
            hint="Exact email or phone, or part of the name"
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
              { value: 'ACTIVE', label: 'Active' },
              { value: 'BLOCKED', label: 'Blocked' },
            ]}
          />
        </label>
        <div className="flex gap-sm">
          <Button type="submit" appearance="primary" iconBefore="search">
            Apply
          </Button>
          <ButtonLink href="/customers" appearance="ghost">
            Clear
          </ButtonLink>
        </div>
      </form>
      {page.items.length === 0 ? (
        <EmptyState
          icon="users"
          headingLevel={2}
          title="No customers found"
          description="Change the search or filters."
        />
      ) : (
        <ul aria-label="Customers" className="flex flex-col gap-sm">
          {page.items.map((customer) => (
            <li
              key={customer.id}
              className="flex flex-col gap-xs rounded-default border border-lowlight bg-white p-md md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-xs">
                <Link href={`/customers/${customer.id}`} variant="body2-medium">
                  {customer.fullName}
                </Link>
                <Text variant="body3" tone="muted">
                  {customer.email} · {customer.phone} · joined {formatDate(customer.createdAt)}
                </Text>
              </div>
              <Badge tone={customer.status === 'ACTIVE' ? 'success' : 'danger'}>
                {customer.status.toLowerCase()}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {page.nextCursor === null ? null : (
        <div>
          <ButtonLink
            href={`/customers?${new URLSearchParams({ ...filterValues, cursor: page.nextCursor }).toString()}`}
          >
            Next page
          </ButtonLink>
        </div>
      )}
    </Flexbox>
  );
}

export default function CustomersPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/customers"
        title="Customers"
        readPermission="customers.read"
        writePermission="customers.block"
      >
        {({ staff }) => <CustomerList staff={staff} searchParams={searchParams} />}
      </AdminPageFrame>
    </Suspense>
  );
}
