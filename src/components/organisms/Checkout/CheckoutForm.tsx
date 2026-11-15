'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { Button, ButtonLink } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Heading } from '@/components/atoms/Heading';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Link } from '@/components/atoms/Link';
import { RadioGroup } from '@/components/atoms/RadioGroup';
import { Skeleton } from '@/components/atoms/Skeleton';
import { Text } from '@/components/atoms/Text';
import type { AddressCardAddress } from '@/components/molecules/AddressCard';
import { sendJson } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { CartSummary } from '../CartPanel/CartSummary';

const breakdownSchema = z.object({
  subtotalPaise: z.number(),
  discountPaise: z.number(),
  taxPaise: z.number(),
  shippingFeePaise: z.number(),
  codFeePaise: z.number(),
  totalPaise: z.number(),
});

const summarySchema = z.object({
  summary: z.object({
    breakdown: breakdownSchema,
    coupon: z
      .object({ code: z.string(), isApplied: z.boolean(), message: z.string().nullable() })
      .nullable(),
    courier: z
      .union([
        z.object({
          isServiceable: z.literal(true),
          courier: z.object({ courierName: z.string(), etaDays: z.number() }),
        }),
        z.object({ isServiceable: z.literal(false), reason: z.string() }),
      ])
      .nullable(),
    codLimitPaise: z.number(),
    codFeePaise: z.number(),
    issues: z.array(z.object({ variantId: z.string(), reason: z.string() })),
  }),
});

const placedSchema = z.object({
  order: z.object({ orderId: z.string(), paymentMethod: z.enum(['COD', 'ONLINE']) }),
});

export type CheckoutSummary = z.infer<typeof summarySchema>['summary'];
type PaymentMethod = 'COD' | 'ONLINE';

const serviceabilityText: Readonly<Record<string, string>> = {
  PINCODE_NOT_SERVICEABLE: 'We do not deliver to this pincode yet. Choose another address.',
  COD_NOT_AVAILABLE: 'Cash on Delivery is not available here. Choose online payment.',
  COD_LIMIT_EXCEEDED: 'This order is above the Cash on Delivery limit here. Choose online payment.',
};

function newIdempotencyKey(): string {
  return `checkout-${crypto.randomUUID()}`;
}

function addressLabel(address: AddressCardAddress): string {
  return `${address.recipientName}${address.isDefault ? ' (default)' : ''}`;
}

function addressDescription(address: AddressCardAddress): string {
  return [
    address.addressLine1,
    address.addressLine2,
    `${address.city}, ${address.state} ${address.pincode}`,
  ]
    .filter((part) => part !== null && part !== '')
    .join(', ');
}

// C27–C32: choose the address and payment method, see the server's price, place the order once. The
// Idempotency-Key is kept for retries of the same attempt and replaced only after a refusal.
export function CheckoutForm({
  addresses,
  initialAddressId,
  initialSummary,
  isOnlinePaymentAvailable,
}: Readonly<{
  addresses: readonly AddressCardAddress[];
  initialAddressId: string | null;
  initialSummary: CheckoutSummary;
  // False in production: the simulated gateway never takes real orders (the server refuses it too).
  isOnlinePaymentAvailable: boolean;
}>) {
  const router = useRouter();
  const [addressId, setAddressId] = useState<string | null>(initialAddressId);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    isOnlinePaymentAvailable ? 'ONLINE' : 'COD',
  );
  const [summary, setSummary] = useState<CheckoutSummary | null>(initialSummary);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [isPlacing, setIsPlacing] = useState(false);
  // While a new choice is being re-priced the shown total is the old one, so ordering waits for it.
  const [isQuoting, setIsQuoting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  // Re-priced by the server whenever the address or payment method changes (and after a refusal).
  async function loadSummary(choice: { addressId: string | null; paymentMethod: PaymentMethod }) {
    const query = new URLSearchParams({ paymentMethod: choice.paymentMethod });
    if (choice.addressId !== null) query.set('addressId', choice.addressId);
    setIsQuoting(true);
    const result = await sendJson(`/api/store/checkout/summary?${query.toString()}`, {
      method: 'GET',
    });
    setIsQuoting(false);
    if (!result.ok) {
      setSummaryError(result.failure.message);
      return;
    }
    const parsed = summarySchema.safeParse(result.data);
    if (parsed.success) {
      setSummary(parsed.data.summary);
      setSummaryError(null);
    }
  }

  async function placeOrder() {
    if (summary === null || addressId === null) return;
    setIsPlacing(true);
    setPlaceError(null);
    const result = await sendJson('/api/store/checkout', {
      body: { addressId, paymentMethod, expectedTotalPaise: summary.breakdown.totalPaise },
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    if (result.ok) {
      const placed = placedSchema.safeParse(result.data);
      if (placed.success) {
        router.push(
          placed.data.order.paymentMethod === 'ONLINE'
            ? `/orders/${placed.data.order.orderId}/pay`
            : `/orders/${placed.data.order.orderId}?placed=1`,
        );
        router.refresh();
        return;
      }
    }
    setIsPlacing(false);
    if (!result.ok) {
      // A refusal means nothing was created; the next attempt is a new request with a new key.
      if (result.failure.status !== 0 && result.failure.status < 500)
        setIdempotencyKey(newIdempotencyKey());
      setPlaceError(result.failure.message);
      await loadSummary({ addressId, paymentMethod });
    }
  }

  if (addresses.length === 0) {
    return (
      <EmptyState
        icon="map-pin"
        headingLevel={2}
        title="Add a delivery address"
        description="You need a saved address before placing an order."
        action={
          <ButtonLink href="/account/addresses" appearance="primary">
            Add an address
          </ButtonLink>
        }
      />
    );
  }

  const courier = summary?.courier ?? null;
  const blockingIssue = (summary?.issues.length ?? 0) > 0;
  const notServiceable = courier !== null && !courier.isServiceable;
  const codLimitPaise =
    paymentMethod === 'COD' &&
    summary !== null &&
    summary.breakdown.totalPaise > summary.codLimitPaise
      ? summary.codLimitPaise
      : null;
  const codOverLimit = codLimitPaise !== null;
  const canPlace =
    !isQuoting &&
    summary !== null &&
    !blockingIssue &&
    !notServiceable &&
    !codOverLimit &&
    summary.breakdown.totalPaise > 0;

  return (
    <div className="grid grid-cols-1 gap-xl lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-lg">
        <Card>
          <div className="flex flex-col gap-md">
            <Heading level={2} variant="heading4">
              1. Delivery address
            </Heading>
            <RadioGroup
              name="addressId"
              label="Deliver to"
              value={addressId}
              onValueChange={(value) => {
                setAddressId(value);
                void loadSummary({ addressId: value, paymentMethod });
              }}
              options={addresses.map((address) => ({
                value: address.id,
                label: addressLabel(address),
                description: addressDescription(address),
              }))}
            />
            <Link href="/account/addresses" variant="body3">
              Add or edit addresses
            </Link>
            {courier === null ? null : courier.isServiceable ? (
              <Text variant="body3" tone="success">
                Delivers in about {courier.courier.etaDays} days with {courier.courier.courierName}.
              </Text>
            ) : (
              <InlineAlert tone="warning">
                {serviceabilityText[courier.reason] ?? 'Not deliverable.'}
              </InlineAlert>
            )}
          </div>
        </Card>
        <Card>
          <div className="flex flex-col gap-md">
            <Heading level={2} variant="heading4">
              2. Payment
            </Heading>
            <RadioGroup
              name="paymentMethod"
              label="Pay with"
              value={paymentMethod}
              onValueChange={(value) => {
                const method = value === 'COD' ? 'COD' : 'ONLINE';
                setPaymentMethod(method);
                void loadSummary({ addressId, paymentMethod: method });
              }}
              options={[
                ...(isOnlinePaymentAvailable
                  ? [
                      {
                        value: 'ONLINE',
                        label: 'Pay online',
                        description: 'Simulated payment gateway for this demo. No fee.',
                      },
                    ]
                  : []),
                {
                  value: 'COD',
                  label: 'Cash on Delivery',
                  description:
                    summary === null
                      ? 'Pay when the order arrives.'
                      : `Pay when the order arrives. ${formatPaise(summary.codFeePaise)} fee; up to ${formatPaise(summary.codLimitPaise)}.`,
                },
              ]}
            />
            {codLimitPaise === null ? null : (
              <InlineAlert tone="warning">
                Cash on Delivery is available up to {formatPaise(codLimitPaise)}. Pay online for
                this order.
              </InlineAlert>
            )}
          </div>
        </Card>
      </div>
      <div className="flex flex-col gap-lg">
        {summary === null ? (
          <Card>
            {summaryError === null ? (
              <Skeleton shape="block" height="md" />
            ) : (
              <InlineAlert tone="danger">{summaryError}</InlineAlert>
            )}
          </Card>
        ) : (
          <CartSummary
            cart={{
              ...summary.breakdown,
              couponCode: summary.coupon?.isApplied === true ? summary.coupon.code : null,
            }}
            title="3. Review and pay"
            codFeeNote={false}
          >
            {summary.coupon !== null && !summary.coupon.isApplied ? (
              <InlineAlert tone="warning">
                Coupon {summary.coupon.code}: {summary.coupon.message}{' '}
                <Link href="/cart" variant="body3">
                  Change it in the cart
                </Link>
              </InlineAlert>
            ) : null}
            {blockingIssue ? (
              <InlineAlert tone="danger">
                Some items are unavailable in that quantity.{' '}
                <Link href="/cart" variant="body3">
                  Update your cart
                </Link>
              </InlineAlert>
            ) : null}
            {placeError === null ? null : <InlineAlert tone="danger">{placeError}</InlineAlert>}
            <Button
              appearance="primary"
              size="lg"
              isFullWidth
              disabled={!canPlace || isPlacing}
              isLoading={isPlacing}
              onClick={() => void placeOrder()}
            >
              {paymentMethod === 'ONLINE'
                ? `Continue to pay ${formatPaise(summary.breakdown.totalPaise)}`
                : `Place order · ${formatPaise(summary.breakdown.totalPaise)}`}
            </Button>
          </CartSummary>
        )}
      </div>
    </div>
  );
}
