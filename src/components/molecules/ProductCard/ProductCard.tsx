import Image from 'next/image';
import { Badge } from '@/components/atoms/Badge';
import { Icon } from '@/components/atoms/Icon';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { PriceTag } from '../PriceTag';
import type { ProductCardProps } from './product-card.types';

export function ProductCard({ product }: ProductCardProps) {
  return (
    <article className="flex h-full flex-col gap-sm rounded-card border border-lowlight bg-white p-md">
      <div className="relative aspect-square w-full overflow-hidden rounded-default bg-strokes">
        {product.imageUrl === null ? (
          <div className="flex h-full items-center justify-center text-grey">
            <Icon name="image" size="lg" />
          </div>
        ) : (
          <Image
            src={product.imageUrl}
            alt={product.imageAlt ?? product.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover"
            unoptimized
          />
        )}
      </div>
      <Text variant="body3" tone="subtitle">
        {product.brandName}
      </Text>
      <Link href={`/products/${product.slug}`} appearance="plain" variant="body2-medium">
        {product.name}
      </Link>
      <PriceTag pricePaise={product.minPricePaise} mrpPaise={product.mrpPaise} prefix="From" />
      <div className="mt-auto flex flex-wrap items-center gap-sm">
        {product.rating === null ? null : (
          <Text as="span" variant="body3" tone="subtitle">
            <span className="inline-flex items-center gap-xs">
              <Icon name="star" size="xs" />
              {product.rating.toFixed(1)} ({product.reviewCount})
            </span>
          </Text>
        )}
        {product.inStock ? null : <Badge tone="danger">Out of stock</Badge>}
      </div>
    </article>
  );
}
