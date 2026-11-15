'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { Badge } from '@/components/atoms/Badge';
import { Button, ButtonLink } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Heading } from '@/components/atoms/Heading';
import { Icon } from '@/components/atoms/Icon';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { useToast } from '@/components/atoms/Toast';
import { FormField } from '@/components/molecules/FormField';
import { QuantityStepper } from '@/components/molecules/QuantityStepper';
import { sendJson } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { formatPaise } from '@/lib/money';
import type { CartLineView, CartLineWarning, CartView } from '@/modules/cart/cart.service';
import { CartSummary } from './CartSummary';

function warningText(warning: CartLineWarning): {
  tone: 'danger' | 'warning' | 'info';
  text: string;
} {
  switch (warning.kind) {
    case 'UNAVAILABLE':
      return { tone: 'danger', text: 'No longer available — remove it to check out' };
    case 'OUT_OF_STOCK':
      return { tone: 'danger', text: 'Out of stock — remove it to check out' };
    case 'QUANTITY_EXCEEDS_STOCK':
      return {
        tone: 'danger',
        text: `Only ${String(warning.availableQuantity)} left — lower the quantity`,
      };
    case 'LOW_STOCK':
      return { tone: 'warning', text: `Only ${String(warning.availableQuantity)} left` };
    case 'PRICE_CHANGED':
      return {
        tone: 'info',
        text: `Price changed from ${formatPaise(warning.previousUnitPricePaise)}`,
      };
  }
}

function CartLine({
  line,
  isBusy,
  onQuantityChange,
  onRemove,
}: Readonly<{
  line: CartLineView;
  isBusy: boolean;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}>) {
  const options = Object.entries(line.optionValues)
    .map(([, value]) => value)
    .join(' · ');
  return (
    <li className="flex flex-col gap-md border-b border-strokes py-lg last:border-b-0 sm:flex-row">
      <div className="relative size-24 shrink-0 overflow-hidden rounded-default bg-strokes">
        {line.imageUrl === null ? (
          <div className="flex h-full items-center justify-center text-grey">
            <Icon name="image" size="md" />
          </div>
        ) : (
          <Image
            src={line.imageUrl}
            alt={line.imageAlt ?? line.productName}
            fill
            sizes="96px"
            className="object-cover"
            unoptimized
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-xs">
        <Text variant="body3" tone="subtitle">
          {line.brandName}
        </Text>
        <Link href={`/products/${line.productSlug}`} appearance="plain" variant="body2-medium">
          {line.productName}
        </Link>
        <Text variant="body3" tone="muted">
          {options === '' ? line.sku : `${options} · ${line.sku}`}
        </Text>
        <div className="flex flex-wrap gap-xs">
          {line.warnings.map((warning) => {
            const { tone, text } = warningText(warning);
            return (
              <Badge key={warning.kind} tone={tone}>
                {text}
              </Badge>
            );
          })}
        </div>
        <div className="mt-sm flex flex-wrap items-center gap-md">
          <QuantityStepper
            label={`Quantity of ${line.productName}`}
            value={line.quantity}
            maximum={Math.max(line.quantity, line.maximumQuantity)}
            isDisabled={isBusy || line.warnings.some(({ kind }) => kind === 'UNAVAILABLE')}
            onChange={onQuantityChange}
          />
          <Button
            appearance="ghost"
            size="sm"
            iconBefore="trash"
            disabled={isBusy}
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      </div>
      <div className="flex flex-col items-start gap-xs sm:items-end">
        <Text variant="body2-medium">{formatPaise(line.lineTotalPaise)}</Text>
        <Text variant="body3" tone="muted">
          {formatPaise(line.unitPricePaise)} each
        </Text>
      </div>
    </li>
  );
}

function CouponForm({
  cart,
  isSignedIn,
  isBusy,
  onApply,
  onRemove,
}: Readonly<{
  cart: CartView;
  isSignedIn: boolean;
  isBusy: boolean;
  onApply: (code: string) => Promise<string | null>;
  onRemove: () => void;
}>) {
  const [error, setError] = useState<string | null>(null);
  if (!isSignedIn) {
    return (
      <Text variant="body3" tone="muted">
        <Link href="/login?next=%2Fcart" variant="body3">
          Sign in
        </Link>{' '}
        to use a coupon.
      </Text>
    );
  }
  if (cart.coupon !== null) {
    return (
      <div className="flex flex-col gap-xs">
        <div className="flex items-center justify-between gap-sm">
          <span className="inline-flex items-center gap-xs">
            <Icon name="ticket" size="sm" />
            <Text variant="body2-medium">{cart.coupon.code}</Text>
          </span>
          <Button appearance="link" size="sm" disabled={isBusy} onClick={onRemove}>
            Remove
          </Button>
        </div>
        {cart.coupon.message === null ? (
          <Text variant="body3" tone="success">
            {cart.coupon.description}
          </Text>
        ) : (
          <Text variant="body3" tone="danger">
            {cart.coupon.message}
          </Text>
        )}
      </div>
    );
  }
  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = formReader(event.currentTarget)('code').trim();
    if (code === '') {
      setError('Enter a coupon code.');
      return;
    }
    setError(await onApply(code));
  }
  return (
    <form
      noValidate
      aria-label="Coupon"
      onSubmit={(event) => void handleSubmit(event)}
      className="flex items-end gap-sm"
    >
      <div className="flex-1">
        <FormField
          label="Coupon code"
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={32}
          error={error ?? undefined}
        />
      </div>
      <Button type="submit" appearance="default" disabled={isBusy}>
        Apply
      </Button>
    </form>
  );
}

// C22–C26: the cart page. Every change goes to the server; the page then re-renders the re-priced cart.
export function CartContents({
  cart,
  isSignedIn,
}: Readonly<{ cart: CartView; isSignedIn: boolean }>) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: unknown,
  ): Promise<string | null> {
    setIsBusy(true);
    setError(null);
    const result = await sendJson(url, body === undefined ? { method } : { method, body });
    setIsBusy(false);
    if (!result.ok) return result.failure.message;
    router.refresh();
    return null;
  }

  async function change(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    const failure = await send(url, method, body);
    if (failure !== null) setError(failure);
  }

  if (cart.lines.length === 0) {
    return (
      <EmptyState
        icon="shopping-cart"
        headingLevel={2}
        title="Your cart is empty"
        description="Find something you like and add it here."
        action={
          <ButtonLink href="/search" appearance="primary">
            Start shopping
          </ButtonLink>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-xl lg:grid-cols-[1fr_22rem]">
      <Card>
        <div className="flex flex-col gap-sm">
          <Heading level={2} variant="heading4">
            {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'}
          </Heading>
          {error === null ? null : <InlineAlert tone="danger">{error}</InlineAlert>}
          <ul aria-label="Cart items">
            {cart.lines.map((line) => (
              <CartLine
                key={line.variantId}
                line={line}
                isBusy={isBusy}
                onQuantityChange={(quantity) =>
                  void change(`/api/store/cart/items/${line.variantId}`, 'PATCH', { quantity })
                }
                onRemove={() => {
                  void change(`/api/store/cart/items/${line.variantId}`, 'DELETE').then(() => {
                    showToast({ title: 'Removed from cart', description: line.productName });
                  });
                }}
              />
            ))}
          </ul>
        </div>
      </Card>
      <div className="flex flex-col gap-lg">
        <Card>
          <CouponForm
            cart={cart}
            isSignedIn={isSignedIn}
            isBusy={isBusy}
            onApply={(code) => send('/api/store/cart/coupon', 'POST', { code })}
            onRemove={() => void change('/api/store/cart/coupon', 'DELETE')}
          />
        </Card>
        <CartSummary cart={cart}>
          {cart.canCheckout ? (
            <ButtonLink href="/checkout" appearance="primary" size="lg" isFullWidth>
              Checkout
            </ButtonLink>
          ) : (
            <InlineAlert tone="warning">
              Fix the items marked above to continue to checkout.
            </InlineAlert>
          )}
        </CartSummary>
      </div>
    </div>
  );
}
