import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Link } from '@/components/atoms/Link';
import { Skeleton } from '@/components/atoms/Skeleton';
import { CheckoutForm } from '@/components/organisms/Checkout';
import { CartContents } from '@/components/organisms/CartPanel';
import { getCustomerCartView } from '@/modules/cart/cart.service';
import { listAddresses } from '@/modules/identity/address.service';
import { quoteCheckout } from '@/modules/ordering/checkout.service';
import { currentCustomerOrRedirect } from '@/modules/identity/current-session';
import { isSimulatedGatewayAvailable } from '@/modules/payment/simulated-gateway';
import { StorePageFrame } from '../store-page-frame';

export const metadata: Metadata = { title: 'Checkout' };

async function Checkout() {
  const customer = await currentCustomerOrRedirect('/checkout');
  const [cart, addresses] = await Promise.all([
    getCustomerCartView(customer),
    listAddresses(customer),
  ]);
  if (cart.lines.length === 0) return <CartContents cart={cart} isSignedIn />;
  const initialAddressId =
    addresses.find((address) => address.isDefault)?.id ?? addresses[0]?.id ?? null;
  const isOnlinePaymentAvailable = isSimulatedGatewayAvailable();
  const initialSummary = await quoteCheckout(customer, {
    addressId: initialAddressId ?? undefined,
    paymentMethod: isOnlinePaymentAvailable ? 'ONLINE' : 'COD',
  });
  return (
    <CheckoutForm
      addresses={addresses}
      initialAddressId={initialAddressId}
      initialSummary={initialSummary}
      isOnlinePaymentAvailable={isOnlinePaymentAvailable}
    />
  );
}

export default function CheckoutPage() {
  return (
    <StorePageFrame>
      <Flexbox direction="column" gap="xl">
        <Flexbox direction="column" gap="xs" align="start">
          <Link href="/cart" appearance="subtle" variant="body3">
            Back to cart
          </Link>
          <Heading level={1} variant="heading2">
            Checkout
          </Heading>
        </Flexbox>
        <Suspense fallback={<Skeleton shape="block" height="lg" />}>
          <Checkout />
        </Suspense>
      </Flexbox>
    </StorePageFrame>
  );
}
