import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Card } from '@/components/atoms/Card';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Link } from '@/components/atoms/Link';
import { Skeleton } from '@/components/atoms/Skeleton';
import { Text } from '@/components/atoms/Text';
import { StoreLayout } from '@/components/layouts/StoreLayout';
import { AccountSessionActions } from '@/components/organisms/AccountSessionActions';
import { ProfileForm } from '@/components/organisms/ProfileForm';
import { getCustomerProfile } from '@/modules/identity/customer-account.service';
import { currentCustomerOrRedirect } from '@/modules/identity/current-session';
import { storeName, storeNavigationLinks } from '../store-shell';

export const metadata: Metadata = { title: 'Your account' };

async function AccountDetails() {
  const customer = await currentCustomerOrRedirect('/account');
  const profile = await getCustomerProfile(customer);
  return (
    <Flexbox direction="column" gap="lg">
      <Card>
        <Flexbox direction="column" gap="lg">
          <Heading level={2} variant="heading4">
            Profile
          </Heading>
          <ProfileForm profile={profile} />
        </Flexbox>
      </Card>
      <Card>
        <Flexbox direction="column" gap="sm" align="start">
          <Heading level={2} variant="heading4">
            Addresses
          </Heading>
          <Text tone="subtitle">Add, edit or remove delivery addresses and pick a default.</Text>
          <Link href="/account/addresses">Manage addresses</Link>
        </Flexbox>
      </Card>
      <Card>
        <Flexbox direction="column" gap="sm">
          <Heading level={2} variant="heading4">
            Sign-in
          </Heading>
          <AccountSessionActions />
        </Flexbox>
      </Card>
    </Flexbox>
  );
}

export default function AccountPage() {
  return (
    <StoreLayout storeName={storeName} navigationLinks={storeNavigationLinks}>
      <Flexbox direction="column" gap="xl">
        <Heading level={1} variant="heading2">
          Your account
        </Heading>
        <Suspense fallback={<Skeleton shape="block" height="lg" />}>
          <AccountDetails />
        </Suspense>
      </Flexbox>
    </StoreLayout>
  );
}
