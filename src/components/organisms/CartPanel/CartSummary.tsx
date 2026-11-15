import type { ReactNode } from 'react';
import { Card } from '@/components/atoms/Card';
import { Heading } from '@/components/atoms/Heading';
import { Text } from '@/components/atoms/Text';
import { formatPaise } from '@/lib/money';

export type PriceSummary = Readonly<{
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  shippingFeePaise: number;
  totalPaise: number;
  codFeePaise?: number;
  freeShippingRemainingPaise?: number;
  couponCode?: string | null;
}>;

function SummaryRow({
  label,
  value,
  isEmphasised = false,
}: Readonly<{ label: string; value: string; isEmphasised?: boolean }>) {
  return (
    <div className="flex items-baseline justify-between gap-md">
      <dt>
        <Text
          as="span"
          variant={isEmphasised ? 'body1-medium' : 'body2'}
          tone={isEmphasised ? 'default' : 'subtitle'}
        >
          {label}
        </Text>
      </dt>
      <dd>
        <Text as="span" variant={isEmphasised ? 'body1-medium' : 'body2'}>
          {value}
        </Text>
      </dd>
    </div>
  );
}

// C24 breakdown shared by cart, checkout and order pages. Prices include GST; the tax line shows the
// included amount and is not added again.
export function CartSummary({
  cart,
  title = 'Order summary',
  codFeeNote = true,
  children,
}: Readonly<{ cart: PriceSummary; title?: string; codFeeNote?: boolean; children?: ReactNode }>) {
  return (
    <Card>
      <div className="flex flex-col gap-md">
        <Heading level={2} variant="heading4">
          {title}
        </Heading>
        <dl className="flex flex-col gap-sm">
          <SummaryRow label="Subtotal" value={formatPaise(cart.subtotalPaise)} />
          {cart.discountPaise > 0 ? (
            <SummaryRow
              label={cart.couponCode == null ? 'Discount' : `Discount (${cart.couponCode})`}
              value={`− ${formatPaise(cart.discountPaise)}`}
            />
          ) : null}
          <SummaryRow
            label="Shipping"
            value={cart.shippingFeePaise === 0 ? 'Free' : formatPaise(cart.shippingFeePaise)}
          />
          {codFeeNote || cart.codFeePaise === undefined || cart.codFeePaise === 0 ? null : (
            <SummaryRow label="Cash on Delivery fee" value={formatPaise(cart.codFeePaise)} />
          )}
          <div className="border-t border-strokes pt-sm">
            <SummaryRow label="Total" value={formatPaise(cart.totalPaise)} isEmphasised />
          </div>
          <Text variant="body3" tone="muted">
            Includes GST of {formatPaise(cart.taxPaise)}
          </Text>
        </dl>
        {cart.freeShippingRemainingPaise === undefined ||
        cart.freeShippingRemainingPaise === 0 ? null : (
          <Text variant="body3" tone="primary">
            Add {formatPaise(cart.freeShippingRemainingPaise)} more for free shipping.
          </Text>
        )}
        {codFeeNote && cart.codFeePaise !== undefined && cart.codFeePaise > 0 ? (
          <Text variant="body3" tone="muted">
            Paying on delivery adds a {formatPaise(cart.codFeePaise)} Cash on Delivery fee; online
            payment has no fee.
          </Text>
        ) : null}
        {children}
      </div>
    </Card>
  );
}
