import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/atoms/Breadcrumb';
import { Flexbox } from '@/components/atoms/Flexbox';
import { ProductReviews } from '@/components/organisms/Reviews';
import { Heading } from '@/components/atoms/Heading';
import { Icon } from '@/components/atoms/Icon';
import { Text } from '@/components/atoms/Text';
import { ProductDetail, SearchResultsGrid } from '@/components/organisms/StorefrontCatalogue';
import { Money } from '@/lib/money';
import { loadStoreSettings } from '@/modules/pricing/store-settings.service';
import { searchStorefront } from '@/modules/storefront/storefront-search.service';
import { isNotFoundError } from '@/lib/errors';
import { getProductReviews } from '@/modules/merchandising/review.service';
import { getStorefrontProductPage } from '@/modules/storefront/storefront-product-page.service';
import { StorePageFrame } from '../../store-page-frame';

// Blocks until the product is loaded, so an unknown slug answers with a real 404 rather than a streamed one.
export const instant = false;

type ProductPageProps = Readonly<{ params: Promise<{ slug: string }> }>;

async function loadProductPage(slug: string) {
  try {
    return await getStorefrontProductPage(slug);
  } catch (error) {
    if (isNotFoundError(error)) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const page = await loadProductPage((await params).slug);
  return { title: page.product.name, description: page.product.description.slice(0, 160) };
}

const rupees = (paise: number) => Money.formatRupees(Money.fromPaise(paise));

// Delivery and returns as the store settings define them (the same values checkout charges).
async function DeliveryAndReturns() {
  const settings = await loadStoreSettings();
  const lines = [
    {
      icon: 'truck' as const,
      text:
        settings.shippingFeePaise === 0
          ? 'Free delivery on every order.'
          : `Free delivery on orders of ${rupees(settings.freeShippingThresholdPaise)} or more; ${rupees(settings.shippingFeePaise)} below that.`,
    },
    {
      icon: 'credit-card' as const,
      text:
        settings.codFeePaise === 0
          ? 'Cash on Delivery where offered for your pincode, at no extra charge.'
          : `Cash on Delivery where offered for your pincode (${rupees(settings.codFeePaise)} fee).`,
    },
    {
      icon: 'undo' as const,
      text:
        settings.returnWindowDays === 0
          ? 'Returns are not accepted.'
          : `Return within ${String(settings.returnWindowDays)} days of delivery.`,
    },
  ];
  return (
    <section
      aria-labelledby="delivery-returns"
      className="flex flex-col gap-md border border-lowlight bg-white p-lg"
    >
      <Heading level={2} variant="heading4" id="delivery-returns">
        Delivery and returns
      </Heading>
      <ul className="flex flex-col gap-sm">
        {lines.map((line) => (
          <li key={line.text} className="flex items-start gap-sm">
            <span className="mt-[2px] text-gold">
              <Icon name={line.icon} size="sm" />
            </span>
            <Text variant="body2" tone="subtitle">
              {line.text}
            </Text>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Up to four other in-stock products from the product's own category.
async function RelatedProducts({
  productId,
  categorySlug,
}: Readonly<{ productId: string; categorySlug: string | undefined }>) {
  if (categorySlug === undefined) return null;
  const { hits } = await searchStorefront({
    text: undefined,
    categorySlug,
    brandSlugs: [],
    minPricePaise: undefined,
    maxPricePaise: undefined,
    inStockOnly: true,
    minimumRating: undefined,
    sort: 'relevance',
    page: 1,
    attributeFilters: [],
  });
  const related = hits.filter((hit) => hit.productId !== productId).slice(0, 4);
  if (related.length === 0) return null;
  return (
    <section aria-labelledby="related-products" className="flex flex-col gap-lg">
      <Heading level={2} variant="heading2-5" id="related-products">
        You may also like
      </Heading>
      <SearchResultsGrid products={related} columns="wide" />
    </section>
  );
}

export default async function ProductPage({ params }: ProductPageProps) {
  const page = await loadProductPage((await params).slug);
  return (
    <StorePageFrame>
      <Flexbox direction="column" gap="2xl">
        <Breadcrumb
          items={[
            { label: 'Home', href: '/' },
            ...page.categoryTrail.map((category) => ({
              label: category.name,
              href: `/categories/${category.slug}`,
            })),
            { label: page.product.name },
          ]}
        />
        <ProductDetail product={page.product} availabilityByVariant={page.availabilityByVariant} />
        <DeliveryAndReturns />
        <ProductReviews list={await getProductReviews(page.product.id)} />
        <RelatedProducts
          productId={page.product.id}
          categorySlug={page.categoryTrail.at(-1)?.slug}
        />
      </Flexbox>
    </StorePageFrame>
  );
}
