import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Link } from '@/components/atoms/Link';
import { Skeleton } from '@/components/atoms/Skeleton';
import { AddressBook } from '@/components/organisms/AddressBook';
import { listAddresses } from '@/modules/identity/address.service';
import { currentCustomerOrRedirect } from '@/modules/identity/current-session';
import { StorePageFrame } from '../../store-page-frame';

export const metadata: Metadata = { title: 'Your addresses' };

async function SavedAddresses() {
  const customer = await currentCustomerOrRedirect('/account/addresses');
  return <AddressBook addresses={await listAddresses(customer)} />;
}

export default function AddressesPage() {
  return (
    <StorePageFrame>
      <Flexbox direction="column" gap="xl">
        <Flexbox direction="column" gap="xs" align="start">
          <Link href="/account" appearance="subtle" variant="body3">
            Your account
          </Link>
          <Heading level={1} variant="heading2">
            Your addresses
          </Heading>
        </Flexbox>
        <Suspense fallback={<Skeleton shape="block" height="lg" />}>
          <SavedAddresses />
        </Suspense>
      </Flexbox>
    </StorePageFrame>
  );
}
