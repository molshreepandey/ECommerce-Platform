import Image from 'next/image';
import NextLink from 'next/link';
import { Badge } from '@/components/atoms/Badge';
import { focusRingClassNames } from '@/components/atoms/focus-ring';
import { Icon } from '@/components/atoms/Icon';
import { Text, textClassNames } from '@/components/atoms/Text';
import { discountPercent } from '../PriceTag/discount';
import { PriceTag } from '../PriceTag';
import type { ProductCardProps } from './product-card.types';
import { displayImageUrl } from '@/modules/catalogue/catalogue-art';

// The whole card opens the product page: the name link stretches over it (one link, named by the product).
// Variants (size, colour, storage) are chosen on the product page, where Add to cart lives.
export function ProductCard({ product }: ProductCardProps) {
  const discount = discountPercent(product.minPricePaise, product.mrpPaise);
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-card border border-lowlight bg-white transition-shadow duration-200 focus-within:shadow-lg hover:border-accent-light-2 hover:shadow-lg">
      <div className="relative aspect-square w-full overflow-hidden bg-strokes">
        {product.imageUrl === null ? (
          <div className="flex h-full items-center justify-center text-grey">
            <Icon name="image" size="lg" />
          </div>
        ) : (
          <Image
            src={displayImageUrl(product.imageUrl)}
            alt={product.imageAlt ?? product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className={`object-cover transition-transform duration-300 group-hover:scale-105 ${product.inStock ? '' : 'opacity-60 grayscale'}`}
            unoptimized
          />
        )}
        {product.inStock ? (
          discount >= 30 ? (
            <span className="absolute top-sm left-sm bg-primary px-sm py-xs text-body4-medium tracking-wider text-white uppercase">
              Top deal
            </span>
          ) : null
        ) : (
          <span className="absolute top-sm left-sm">
            <Badge tone="danger">Out of stock</Badge>
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-xs p-sm sm:gap-sm sm:p-md">
        <Text variant="body4-medium" tone="subtitle">
          <span className="tracking-wide uppercase">{product.brandName}</span>
        </Text>
        <NextLink
          href={`/products/${product.slug}`}
          className={`line-clamp-2 rounded-default text-headings after:absolute after:inset-0 hover:text-primary ${focusRingClassNames} ${textClassNames({ variant: 'body2-medium' })}`}
        >
          {product.name}
        </NextLink>
        <PriceTag pricePaise={product.minPricePaise} mrpPaise={product.mrpPaise} prefix="From" />
        <div className="mt-auto flex flex-wrap items-center justify-between gap-sm pt-xs">
          {product.rating === null ? (
            <Text as="span" variant="body3" tone="muted">
              No reviews yet
            </Text>
          ) : (
            <span className="inline-flex items-center gap-xs rounded-pill bg-green-50 px-sm py-xs">
              <Icon name="star" size="xs" />
              <Text as="span" variant="body3-medium">
                {product.rating.toFixed(1)}
              </Text>
              <Text as="span" variant="body3" tone="muted">
                ({product.reviewCount})
              </Text>
            </span>
          )}
          {product.inStock ? (
            <span className="inline-flex items-center gap-xs">
              <span aria-hidden="true" className="size-2 rounded-pill bg-status-green" />
              <Text as="span" variant="body3" tone="success">
                Available
              </Text>
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
