import { connection } from 'next/server';
import { Suspense } from 'react';
import { Badge } from '@/components/atoms/Badge';
import { ButtonLink } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Grid } from '@/components/atoms/Grid';
import { Heading } from '@/components/atoms/Heading';
import { Link } from '@/components/atoms/Link';
import { Skeleton } from '@/components/atoms/Skeleton';
import { Text } from '@/components/atoms/Text';
import { HomeBanners } from '@/components/organisms/Merchandising';
import { SearchResultsGrid } from '@/components/organisms/StorefrontCatalogue';
import { getHomeMerchandising } from '@/modules/merchandising/merchandising.cache';
import { visibleNow } from '@/modules/merchandising/merchandising.service';
import { searchStorefront } from '@/modules/storefront/storefront-search.service';
import { getStorefrontCategoryTree } from '@/modules/taxonomy/storefront-category.cache';
import { StorePageFrame } from './store-page-frame';

const storePromises = [
  {
    title: 'Pay online or on delivery',
    description: 'Pay securely online, or with Cash on Delivery at your door.',
    badge: 'Flexible',
  },
  {
    title: 'Ships from the nearest stock',
    description: 'Orders are packed at the warehouse that has your items ready.',
    badge: 'Fast',
  },
  {
    title: 'Track every shipment',
    description: 'Follow each package from pickup to delivery in your orders.',
    badge: 'Live',
  },
] as const;

async function HomeMerchandising() {
  await connection();
  const { banners, collections } = await getHomeMerchandising();
  const now = new Date();
  const liveCollections = visibleNow(collections, now);
  return (
    <>
      <HomeBanners banners={visibleNow(banners, now)} />
      {liveCollections.length === 0 ? null : (
        <section aria-labelledby="collections" className="flex flex-col gap-md">
          <Heading level={2} variant="heading3" id="collections">
            Collections
          </Heading>
          <Grid columns={3} gap="md" as="ul">
            {liveCollections.map((collection) => (
              <Card as="li" key={collection.id}>
                <Flexbox direction="column" gap="xs">
                  <Link
                    href={`/collections/${collection.slug}`}
                    appearance="plain"
                    variant="body1-medium"
                  >
                    {collection.name}
                  </Link>
                  <Text variant="body3" tone="muted">
                    {collection.description}
                  </Text>
                </Flexbox>
              </Card>
            ))}
          </Grid>
        </section>
      )}
    </>
  );
}

async function TopCategories() {
  await connection();
  const categories = await getStorefrontCategoryTree();
  if (categories.length === 0) return null;
  return (
    <section aria-labelledby="top-categories" className="flex flex-col gap-md">
      <Flexbox justify="between" align="center">
        <Heading level={2} variant="heading3" id="top-categories">
          Shop by category
        </Heading>
        <Link href="/categories">All categories</Link>
      </Flexbox>
      <Grid columns={4} gap="md" as="ul">
        {categories.map((category) => (
          <Card as="li" key={category.id}>
            <Flexbox direction="column" gap="xs">
              <Link href={`/categories/${category.slug}`} appearance="plain" variant="body1-medium">
                {category.name}
              </Link>
              <Text variant="body3" tone="muted">
                {category.children
                  .slice(0, 3)
                  .map((child) => child.name)
                  .join(' · ')}
              </Text>
            </Flexbox>
          </Card>
        ))}
      </Grid>
    </section>
  );
}

async function NewArrivals() {
  await connection();
  const result = await searchStorefront({
    text: undefined,
    categorySlug: undefined,
    brandSlugs: [],
    minPricePaise: undefined,
    maxPricePaise: undefined,
    inStockOnly: true,
    minimumRating: undefined,
    sort: 'newest',
    page: 1,
    attributeFilters: [],
  });
  if (result.hits.length === 0) return null;
  return (
    <section aria-labelledby="new-arrivals" className="flex flex-col gap-md">
      <Flexbox justify="between" align="center">
        <Heading level={2} variant="heading3" id="new-arrivals">
          New arrivals
        </Heading>
        <Link href="/search?sort=newest">See all</Link>
      </Flexbox>
      <SearchResultsGrid products={result.hits.slice(0, 6)} />
    </section>
  );
}

export default function StoreHomePage() {
  return (
    <StorePageFrame>
      <Flexbox direction="column" gap="2xl">
        <Card padding="2xl" elevation="raised">
          <Flexbox direction="column" gap="lg" align="start">
            <Badge tone="info">Now open</Badge>
            <Heading level={1} variant="heading1">
              Everyday essentials, delivered
            </Heading>
            <Text variant="body1" tone="subtitle">
              Browse apparel, footwear, electronics and beauty. Prices in ₹, GST included.
            </Text>
            <Flexbox gap="sm" wrap="wrap">
              <ButtonLink href="/search" appearance="primary" size="lg" iconBefore="shopping-cart">
                Start shopping
              </ButtonLink>
              <ButtonLink href="/categories" appearance="default" size="lg" iconBefore="layers">
                Browse categories
              </ButtonLink>
            </Flexbox>
          </Flexbox>
        </Card>
        <Suspense fallback={<Skeleton shape="block" height="md" />}>
          <HomeMerchandising />
        </Suspense>
        <Suspense fallback={<Skeleton shape="block" height="md" />}>
          <TopCategories />
        </Suspense>
        <Suspense fallback={<Skeleton shape="block" height="lg" />}>
          <NewArrivals />
        </Suspense>
        <Grid columns={3} gap="lg" as="ul">
          {storePromises.map((storePromise) => (
            <Card as="li" key={storePromise.title}>
              <Flexbox direction="column" gap="sm" align="start">
                <Badge tone="success">{storePromise.badge}</Badge>
                <Heading level={2} variant="heading4">
                  {storePromise.title}
                </Heading>
                <Text tone="subtitle">{storePromise.description}</Text>
              </Flexbox>
            </Card>
          ))}
        </Grid>
      </Flexbox>
    </StorePageFrame>
  );
}
