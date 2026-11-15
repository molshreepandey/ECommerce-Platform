import { Text } from '@/components/atoms/Text';
import { Money } from '@/lib/money';
import { discountPercent } from './discount';
import type { PriceTagProps } from './price-tag.types';

// Price, MRP struck through and the discount (C15). Prices are GST-inclusive (plan §10A rule 9).
export function PriceTag({ pricePaise, mrpPaise, size = 'sm', prefix }: PriceTagProps) {
  const discount = discountPercent(pricePaise, mrpPaise);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-sm">
      <Text as="span" variant={size === 'lg' ? 'body1-medium' : 'body2-medium'}>
        {prefix === undefined ? '' : `${prefix} `}
        {Money.formatRupees(Money.fromPaise(pricePaise))}
      </Text>
      {discount > 0 ? (
        <>
          <span className="line-through">
            <Text as="span" variant="body3" tone="muted">
              MRP {Money.formatRupees(Money.fromPaise(mrpPaise))}
            </Text>
          </span>
          <Text as="span" variant="body3-medium" tone="success">
            {discount}% off
          </Text>
        </>
      ) : null}
    </span>
  );
}
