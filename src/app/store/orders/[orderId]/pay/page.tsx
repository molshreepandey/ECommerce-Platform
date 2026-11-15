import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Link } from '@/components/atoms/Link';
import { Skeleton } from '@/components/atoms/Skeleton';
import { OnlinePaymentPanel } from '@/components/organisms/Checkout';
import { currentCustomerOrRedirect } from '@/modules/identity/current-session';
import { maximumDeclinedAttempts } from '@/modules/payment/payment.schema';
import { StorePageFrame } from '../../../store-page-frame';
import { loadCustomerOrderOrNotFound } from '../../order-page-parts';

export const metadata: Metadata = { title: 'Pay for your order' };

type PageProps = Readonly<{ params: Promise<{ orderId: string }> }>;

async function PaymentStep({ params }: PageProps) {
  const { orderId } = await params;
  const customer = await currentCustomerOrRedirect(`/orders/${orderId}/pay`);
  const order = await loadCustomerOrderOrNotFound(customer, orderId);
  const payment = order.payment;
  if (
    order.paymentMethod !== 'ONLINE' ||
    payment?.status !== 'PENDING' ||
    order.status !== 'PLACED'
  ) {
    redirect(`/orders/${order.id}`);
  }
  const declines = payment.attempts.filter(({ outcome }) => outcome === 'DECLINED').length;
  return (
    <div className="mx-auto w-full max-w-xl">
      <OnlinePaymentPanel
        orderId={order.id}
        orderNumber={order.orderNumber}
        amountPaise={payment.amountPaise}
        attemptsRemaining={Math.max(0, maximumDeclinedAttempts - declines)}
      />
    </div>
  );
}

export default function PaymentPage(props: PageProps) {
  return (
    <StorePageFrame>
      <Flexbox direction="column" gap="xl">
        <Flexbox direction="column" gap="xs" align="start">
          <Link href="/orders" appearance="subtle" variant="body3">
            Your orders
          </Link>
          <Heading level={1} variant="heading2">
            Payment
          </Heading>
        </Flexbox>
        <Suspense fallback={<Skeleton shape="block" height="lg" />}>
          <PaymentStep {...props} />
        </Suspense>
      </Flexbox>
    </StorePageFrame>
  );
}
