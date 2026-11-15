'use client';

import Image from 'next/image';
import { useState } from 'react';
import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { Heading } from '@/components/atoms/Heading';
import { Icon } from '@/components/atoms/Icon';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { PriceTag } from '@/components/molecules/PriceTag';
import type { StorefrontProduct } from '@/modules/catalogue/storefront-product.service';
import { AddToCartPanel } from '../CartPanel';
import { PincodeCheck } from './PincodeCheck';
import {
  findVariantForSelection,
  initialSelection,
  optionValueState,
  selectOptionValue,
} from './variant-selection';
import { focusRingClassNames } from '@/components/atoms/focus-ring';
import { displayImageUrl } from '@/modules/catalogue/catalogue-art';

const lowStockThreshold = 5;

type ProductDetailProps = Readonly<{
  product: StorefrontProduct;
  availabilityByVariant: Readonly<Record<string, number>>;
}>;

function availabilityMessage(availableQuantity: number) {
  if (availableQuantity <= 0) return <Badge tone="danger">Out of stock</Badge>;
  if (availableQuantity <= lowStockThreshold) {
    return <Badge tone="warning">Only {availableQuantity} left</Badge>;
  }
  return <Badge tone="success">In stock</Badge>;
}

function Gallery({
  media: allMedia,
  productName,
  preferredVariantId,
}: Readonly<{
  media: StorefrontProduct['media'];
  productName: string;
  preferredVariantId: string | null;
}>) {
  const [chosenMediaId, setChosenMediaId] = useState<string | null>(null);
  // Several stored images can show the same picture (one bundled photograph per demo product): show it once.
  const media = allMedia.filter(
    (item, index) =>
      allMedia.findIndex((other) => displayImageUrl(other.url) === displayImageUrl(item.url)) ===
      index,
  );
  const preferred = media.find((item) => item.variantId === preferredVariantId) ?? media[0];
  const shown = media.find((item) => item.id === chosenMediaId) ?? preferred;
  return (
    <div className="flex flex-col gap-md">
      <div className="relative aspect-square w-full overflow-hidden rounded-card border border-lowlight bg-strokes">
        {shown === undefined ? (
          <div className="flex h-full items-center justify-center text-grey">
            <Icon name="image" size="lg" />
          </div>
        ) : (
          <Image
            src={displayImageUrl(shown.url)}
            alt={shown.altText === '' ? productName : shown.altText}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-cover"
            unoptimized
            priority
          />
        )}
      </div>
      {media.length < 2 ? null : (
        <ul aria-label="Product images" className="flex flex-wrap gap-sm">
          {media.map((item, index) => {
            const isShown = item.id === shown?.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-label={`Image ${String(index + 1)}`}
                  aria-pressed={isShown}
                  onClick={() => {
                    setChosenMediaId(item.id);
                  }}
                  className={`relative block size-16 overflow-hidden rounded-default border-2 bg-strokes transition-colors sm:size-20 ${isShown ? 'border-primary' : 'border-lowlight hover:border-accent-light-2'} ${focusRingClassNames}`}
                >
                  <Image
                    src={displayImageUrl(item.url)}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover"
                    unoptimized
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// C15–C18: gallery, price against MRP, variant picker with unavailable values disabled, live availability
// (summed over active warehouses, no warehouse named), group swatches and the attribute table.
export function ProductDetail({ product, availabilityByVariant }: ProductDetailProps) {
  const [selection, setSelection] = useState(() =>
    initialSelection(product.variants, availabilityByVariant),
  );
  const variant = findVariantForSelection(product.variants, selection);
  const availableQuantity = variant === null ? 0 : (availabilityByVariant[variant.id] ?? 0);
  return (
    <div className="grid grid-cols-1 gap-xl md:grid-cols-2">
      <Gallery
        media={product.media}
        productName={product.name}
        preferredVariantId={variant?.id ?? null}
      />
      <div className="flex flex-col gap-lg">
        <div className="flex flex-col gap-xs">
          <Link
            href={`/search?brand=${encodeURIComponent(product.brand.slug)}`}
            appearance="subtle"
            variant="body2"
          >
            {product.brand.name}
          </Link>
          <Heading level={1} variant="heading2">
            {product.name}
          </Heading>
        </div>
        {variant === null ? null : (
          <div className="flex flex-col gap-xs">
            <PriceTag pricePaise={variant.pricePaise} mrpPaise={variant.mrpPaise} size="lg" />
            <Text variant="body3" tone="muted">
              Inclusive of all taxes · SKU {variant.sku}
            </Text>
          </div>
        )}
        <div>{availabilityMessage(availableQuantity)}</div>
        {product.options.map((option) => (
          <fieldset key={option.code} className="flex flex-col gap-sm">
            <legend className="mb-sm">
              <Text as="span" variant="body2-medium">
                {option.label}: {selection[option.code] ?? '—'}
              </Text>
            </legend>
            <div className="flex flex-wrap gap-sm">
              {option.values.map((value) => {
                const state = optionValueState(
                  product.variants,
                  availabilityByVariant,
                  selection,
                  option.code,
                  value,
                );
                const isSelected = selection[option.code] === value;
                return (
                  <Button
                    key={value}
                    size="sm"
                    appearance={isSelected ? 'primary' : 'default'}
                    aria-pressed={isSelected}
                    disabled={state !== 'available' && !isSelected}
                    title={state === 'out-of-stock' ? `${value}: out of stock` : undefined}
                    onClick={() => {
                      setSelection(
                        selectOptionValue(
                          product.variants,
                          availabilityByVariant,
                          selection,
                          option.code,
                          value,
                        ),
                      );
                    }}
                  >
                    {value}
                  </Button>
                );
              })}
            </div>
          </fieldset>
        ))}
        {product.swatches.length === 0 ? null : (
          <nav aria-label="Other options" className="flex flex-col gap-sm">
            <Text variant="body2-medium">Other options</Text>
            <ul className="flex flex-wrap gap-sm">
              {product.swatches.map((swatch) => (
                <li key={swatch.productId}>
                  {swatch.isCurrent ? (
                    <Badge tone="primary">{swatch.label}</Badge>
                  ) : (
                    <Link href={`/products/${swatch.slug}`} variant="body2">
                      {swatch.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        )}
        <AddToCartPanel
          variantId={variant?.id ?? null}
          availableQuantity={availableQuantity}
          productName={product.name}
        />
        <PincodeCheck />
        {product.description === '' ? null : (
          <section aria-labelledby="product-description" className="flex flex-col gap-sm">
            <Heading level={2} variant="heading5" id="product-description">
              Description
            </Heading>
            <Text tone="subtitle">{product.description}</Text>
          </section>
        )}
        {product.attributes.length === 0 ? null : (
          <section aria-labelledby="product-details" className="flex flex-col gap-sm">
            <Heading level={2} variant="heading5" id="product-details">
              Product details
            </Heading>
            <dl className="grid grid-cols-2 gap-x-lg gap-y-sm rounded-card border border-lowlight bg-white p-md">
              {product.attributes.map((attribute) => (
                <div key={attribute.code} className="contents">
                  <dt>
                    <Text as="span" variant="body2" tone="muted">
                      {attribute.label}
                    </Text>
                  </dt>
                  <dd>
                    <Text as="span" variant="body2">
                      {attribute.value}
                    </Text>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}
