import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Skeleton } from '@/components/atoms/Skeleton';
import { CartContents } from '@/components/organisms/CartPanel';
import { currentVisitorCart } from '../store-cart';
import { StorePageFrame } from '../store-page-frame';

export const metadata: Metadata = { title: 'Your cart' };

async function VisitorCart() {
  const { cart, customer } = await currentVisitorCart();
  return <CartContents cart={cart} isSignedIn={customer !== null} />;
}

export default function CartPage() {
  return (
    <StorePageFrame>
      <Flexbox direction="column" gap="xl">
        <Heading level={1} variant="heading2">
          Your cart
        </Heading>
        <Suspense fallback={<Skeleton shape="block" height="lg" />}>
          <VisitorCart />
        </Suspense>
      </Flexbox>
    </StorePageFrame>
  );
}
