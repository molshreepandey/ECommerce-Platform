import Image from 'next/image';
import NextLink from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ButtonLink } from '@/components/atoms/Button';
import { focusRingClassNames } from '@/components/atoms/focus-ring';
import { Heading } from '@/components/atoms/Heading';
import { Icon, type IconName } from '@/components/atoms/Icon';
import { Link } from '@/components/atoms/Link';
import { Skeleton } from '@/components/atoms/Skeleton';
import { Text } from '@/components/atoms/Text';
import { HomeBanners } from '@/components/organisms/Merchandising';
import { SearchResultsGrid } from '@/components/organisms/StorefrontCatalogue';
import { getHomeMerchandising } from '@/modules/merchandising/merchandising.cache';
import { visibleNow } from '@/modules/merchandising/merchandising.service';
import type { ProductSearchQuery } from '@/modules/search/product-search.schema';
import { searchStorefront } from '@/modules/storefront/storefront-search.service';
import { getStorefrontCategoryTree } from '@/modules/taxonomy/storefront-category.cache';
import { StorePageFrame } from './store-page-frame';
import { categoryArtUrl, displayImageUrl } from '@/modules/catalogue/catalogue-art';

const storePromises: readonly { title: string; description: string; icon: IconName }[] = [
  {
    title: 'Pay online or on delivery',
    description: 'Pay securely online, or with Cash on Delivery at your door.',
    icon: 'credit-card',
  },
  {
    title: 'Packed where it is in stock',
    description: 'Orders are packed at the warehouse that has your items ready.',
    icon: 'package',
  },
  {
    title: 'Track every shipment',
    description: 'Follow each package from pickup to delivery in your orders.',
    icon: 'truck',
  },
];

// Look of the top-level category tiles; a category not listed here gets the neutral look.
const categoryLooks: Readonly<Record<string, { icon: IconName; tileClassName: string }>> = {
  electronics: { icon: 'smartphone', tileClassName: 'bg-accent-light-1' },
  apparel: { icon: 'shirt', tileClassName: 'bg-highlight-3' },
  footwear: { icon: 'footprints', tileClassName: 'bg-yellow-100' },
  beauty: { icon: 'sparkles', tileClassName: 'bg-highlight-4' },
};
const neutralCategoryLook = { icon: 'layers', tileClassName: 'bg-strokes' } as const;

const browseQuery: ProductSearchQuery = {
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
};

function SectionHeader({
  id,
  title,
  subtitle,
  link,
}: Readonly<{
  id: string;
  title: string;
  subtitle: string;
  link?: { href: string; label: string };
}>) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-sm">
      <div className="flex flex-col gap-xs">
        <Heading level={2} variant="heading2-5" id={id}>
          {title}
        </Heading>
        <Text variant="body2" tone="subtitle">
          {subtitle}
        </Text>
      </div>
      {link === undefined ? null : (
        <Link href={link.href} variant="body2-medium">
          <span className="inline-flex items-center gap-xs">
            {link.label}
            <Icon name="arrow-right" size="xs" />
          </span>
        </Link>
      )}
    </div>
  );
}

// Four in-stock products from the catalogue beside the hero copy; nothing when the catalogue is empty.
async function HeroShowcase() {
  await connection();
  const { hits } = await searchStorefront({ ...browseQuery, sort: 'price_desc' });
  const showcase = hits.filter((hit) => hit.imageUrl !== null).slice(0, 4);
  if (showcase.length < 4) return null;
  return (
    <ul aria-label="Featured products" className="grid grid-cols-2 gap-md">
      {showcase.map((product, index) => (
        <li key={product.productId} className={index % 2 === 1 ? 'translate-y-lg' : ''}>
          <NextLink
            href={`/products/${product.slug}`}
            className={`group relative block aspect-square overflow-hidden rounded-card bg-white/10 shadow-lg ${focusRingClassNames}`}
          >
            <Image
              src={displayImageUrl(product.imageUrl ?? '')}
              alt={product.imageAlt ?? product.name}
              fill
              sizes="(max-width: 768px) 45vw, 280px"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              unoptimized
            />
            <span className="absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-headings/85 to-transparent px-md pt-xl pb-sm">
              <Text as="span" variant="body3-medium" tone="inverse">
                {product.name}
              </Text>
            </span>
          </NextLink>
        </li>
      ))}
    </ul>
  );
}

function Hero() {
  return (
    <section
      aria-labelledby="home-heading"
      className="relative overflow-hidden rounded-card bg-linear-to-br from-primary-gradient-1 via-primary to-nav-background px-lg py-2xl text-white sm:px-3xl sm:py-3xl"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-pill bg-white/10 blur-2xl"
      />
      <div className="relative grid items-center gap-2xl md:grid-cols-2">
        <div className="flex flex-col items-start gap-lg">
          <span className="inline-flex items-center gap-xs rounded-pill bg-white/15 px-md py-xs text-body3-medium text-white">
            <Icon name="sparkles" size="xs" />
            Electronics · Fashion · Footwear · Beauty
          </span>
          <h1
            id="home-heading"
            className="text-heading2 text-white sm:text-heading1-5 lg:text-heading1"
          >
            Everyday essentials, delivered
          </h1>
          <p className="max-w-[34rem] text-body1 text-white/90">
            Discover top brands at honest prices. Every price is in ₹ with GST included, and you can
            pay online or with Cash on Delivery.
          </p>
          <div className="flex flex-wrap gap-sm">
            <ButtonLink href="/search" appearance="default" size="lg" iconBefore="shopping-cart">
              Start shopping
            </ButtonLink>
            <ButtonLink href="/categories" appearance="subtle" size="lg" iconBefore="layers">
              Browse categories
            </ButtonLink>
          </div>
        </div>
        <Suspense fallback={null}>
          <HeroShowcase />
        </Suspense>
      </div>
    </section>
  );
}

async function TopCategories() {
  await connection();
  const categories = await getStorefrontCategoryTree();
  if (categories.length === 0) return null;
  return (
    <section aria-labelledby="top-categories" className="flex flex-col gap-lg">
      <SectionHeader
        id="top-categories"
        title="Shop by category"
        subtitle="Find what you need, from the latest phones to everyday beauty."
        link={{ href: '/categories', label: 'All categories' }}
      />
      <ul className="grid grid-cols-2 gap-sm sm:gap-lg lg:grid-cols-4">
        {categories.map((category) => {
          const look = categoryLooks[category.slug] ?? neutralCategoryLook;
          const artUrl = categoryArtUrl(category.slug);
          return (
            <li key={category.id}>
              <NextLink
                href={`/categories/${category.slug}`}
                className={`group flex h-full flex-col gap-sm rounded-card p-md transition-shadow hover:shadow-lg sm:p-lg ${look.tileClassName} ${focusRingClassNames}`}
              >
                {artUrl === null ? (
                  <span className="inline-flex size-10 items-center justify-center rounded-pill bg-white text-primary shadow-sm sm:size-12">
                    <Icon name={look.icon} size="md" />
                  </span>
                ) : (
                  <span className="relative block aspect-[4/3] w-full overflow-hidden rounded-card bg-white/60">
                    <Image
                      src={artUrl}
                      alt=""
                      fill
                      sizes="(max-width: 1024px) 45vw, 260px"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                      unoptimized
                    />
                  </span>
                )}
                <Text as="span" variant="body1-medium">
                  {category.name}
                </Text>
                <Text as="span" variant="body3" tone="subtitle">
                  {category.children
                    .slice(0, 3)
                    .map((child) => child.name)
                    .join(' · ')}
                </Text>
                <span className="mt-auto inline-flex items-center gap-xs pt-xs text-primary">
                  <Text as="span" variant="body3-medium" tone="primary">
                    Shop now
                  </Text>
                  <Icon name="arrow-right" size="xs" />
                </span>
              </NextLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function HomeMerchandising() {
  await connection();
  const { banners, collections } = await getHomeMerchandising();
  const now = new Date();
  const liveCollections = visibleNow(collections, now);
  return (
    <>
      <HomeBanners banners={visibleNow(banners, now)} />
      {liveCollections.length === 0 ? null : (
        <section aria-labelledby="collections" className="flex flex-col gap-lg">
          <SectionHeader
            id="collections"
            title="Collections"
            subtitle="Hand-picked edits for the season."
          />
          <ul className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
            {liveCollections.map((collection) => (
              <li key={collection.id}>
                <NextLink
                  href={`/collections/${collection.slug}`}
                  className={`group flex h-full flex-col gap-xs rounded-card border border-lowlight bg-linear-to-br from-white to-accent-light-1 p-lg transition-shadow hover:shadow-lg ${focusRingClassNames}`}
                >
                  <Text as="span" variant="body1-medium">
                    {collection.name}
                  </Text>
                  <Text as="span" variant="body3" tone="subtitle">
                    {collection.description}
                  </Text>
                  <span className="mt-auto inline-flex items-center gap-xs pt-sm">
                    <Text as="span" variant="body3-medium" tone="primary">
                      Shop the edit
                    </Text>
                    <Icon name="arrow-right" size="xs" />
                  </span>
                </NextLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

async function ProductShelf({
  id,
  title,
  subtitle,
  query,
  link,
}: Readonly<{
  id: string;
  title: string;
  subtitle: string;
  query: Partial<ProductSearchQuery>;
  link: { href: string; label: string };
}>) {
  await connection();
  const result = await searchStorefront({ ...browseQuery, ...query });
  if (result.hits.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-lg">
      <SectionHeader id={id} title={title} subtitle={subtitle} link={link} />
      <SearchResultsGrid products={result.hits.slice(0, 8)} columns="wide" />
    </section>
  );
}

function StorePromises() {
  return (
    <ul className="grid grid-cols-1 gap-md rounded-card border border-lowlight bg-white p-lg sm:grid-cols-3 sm:p-xl">
      {storePromises.map((storePromise) => (
        <li key={storePromise.title} className="flex items-start gap-md">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-accent-light-1 text-primary">
            <Icon name={storePromise.icon} size="sm" />
          </span>
          <div className="flex flex-col gap-xs">
            <Heading level={2} variant="heading4">
              {storePromise.title}
            </Heading>
            <Text variant="body3" tone="subtitle">
              {storePromise.description}
            </Text>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function StoreHomePage() {
  return (
    <StorePageFrame>
      <div className="flex flex-col gap-3xl">
        <Hero />
        <Suspense fallback={<Skeleton shape="block" height="md" />}>
          <TopCategories />
        </Suspense>
        <Suspense fallback={<Skeleton shape="block" height="lg" />}>
          <ProductShelf
            id="new-arrivals"
            title="New arrivals"
            subtitle="The latest additions to the catalogue, in stock now."
            query={{ sort: 'newest' }}
            link={{ href: '/search?sort=newest&inStock=true', label: 'See all' }}
          />
        </Suspense>
        <Suspense fallback={<Skeleton shape="block" height="md" />}>
          <HomeMerchandising />
        </Suspense>
        <Suspense fallback={<Skeleton shape="block" height="lg" />}>
          <ProductShelf
            id="under-999"
            title="Under ₹999"
            subtitle="Everyday favourites at a great price."
            query={{ maxPricePaise: 99_900, sort: 'price_desc' }}
            link={{ href: '/search?maxPrice=999&inStock=true&sort=price_desc', label: 'See all' }}
          />
        </Suspense>
        <StorePromises />
      </div>
    </StorePageFrame>
  );
}
