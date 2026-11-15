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
import { isNotFoundError } from '@/lib/errors';
import { SearchResultsGrid } from '@/components/organisms/StorefrontCatalogue';
import {
  categoryArtUrl,
  displayImageUrl,
  productPhotoUrl,
} from '@/modules/catalogue/catalogue-art';
import { getHomeMerchandising } from '@/modules/merchandising/merchandising.cache';
import { visibleNow } from '@/modules/merchandising/merchandising.service';
import type { ProductSearchHit, ProductSearchQuery } from '@/modules/search/product-search.schema';
import { findBestSellingProducts } from '@/modules/storefront/best-sellers.service';
import { searchStorefront } from '@/modules/storefront/storefront-search.service';
import { getStorefrontCategoryTree } from '@/modules/taxonomy/storefront-category.cache';
import { StorePageFrame } from './store-page-frame';

const storePromises: readonly { title: string; description: string; icon: IconName }[] = [
  {
    title: 'Pay online or on delivery',
    description: 'Pay online, or with Cash on Delivery where it is offered for your pincode.',
    icon: 'credit-card',
  },
  {
    title: 'Check delivery before you buy',
    description: 'Enter your pincode on any product to see whether and when we deliver there.',
    icon: 'map-pin',
  },
  {
    title: 'Track every shipment',
    description: 'Follow each package from pickup to delivery in your orders.',
    icon: 'truck',
  },
];

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
  eyebrow,
  title,
  link,
}: Readonly<{
  id: string;
  eyebrow: string;
  title: string;
  link?: { href: string; label: string };
}>) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-sm border-b border-lowlight pb-md">
      <div className="flex flex-col gap-xs">
        <Text as="p" variant="body3-medium" tone="subtitle">
          <span className="tracking-[0.18em] text-gold uppercase">{eyebrow}</span>
        </Text>
        <Heading level={2} variant="heading2" id={id}>
          {title}
        </Heading>
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

function Shelf({
  id,
  eyebrow,
  title,
  products,
  link,
}: Readonly<{
  id: string;
  eyebrow: string;
  title: string;
  products: readonly ProductSearchHit[];
  link?: { href: string; label: string };
}>) {
  if (products.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-xl">
      <SectionHeader
        id={id}
        eyebrow={eyebrow}
        title={title}
        {...(link === undefined ? {} : { link })}
      />
      <SearchResultsGrid products={products.slice(0, 8)} columns="wide" />
    </section>
  );
}

const heroDepartments = ['apparel', 'footwear', 'beauty'] as const;

// One in-stock product from each of these departments, preferring one with a real photograph; a missing
// department or an empty catalogue simply leaves it out.
async function heroPicks(): Promise<{ department: string; product: ProductSearchHit }[]> {
  const picks = await Promise.all(
    heroDepartments.map(async (department) => {
      try {
        const { hits, category } = await searchStorefront({
          ...browseQuery,
          categorySlug: department,
          sort: 'relevance',
        });
        const withImage = hits.filter((hit) => hit.imageUrl !== null);
        const product = withImage.find((hit) => productPhotoUrl(hit.slug) !== null) ?? withImage[0];
        const name = category?.trail.at(-1)?.name ?? department;
        return product === undefined ? null : { department: name, product };
      } catch (error) {
        // Only a department that does not exist (or is inactive) is skipped; other failures surface.
        if (isNotFoundError(error)) return null;
        throw error;
      }
    }),
  );
  return picks.filter((pick) => pick !== null);
}

// The hero collage: a tall picture beside two stacked ones, each a real product linking to its page.
async function HeroShowcase() {
  await connection();
  const picks = await heroPicks();
  if (picks.length < 3) return null;
  return (
    <ul
      aria-label="Featured products"
      className="grid h-[26rem] grid-cols-2 grid-rows-2 gap-sm sm:h-[32rem] sm:gap-md lg:h-[36rem]"
    >
      {picks.map(({ department, product }, index) => (
        <li key={product.productId} className={index === 0 ? 'row-span-2' : ''}>
          <NextLink
            href={`/products/${product.slug}`}
            className={`group relative block h-full overflow-hidden bg-white ${focusRingClassNames}`}
          >
            <Image
              src={displayImageUrl(product.imageUrl ?? '')}
              alt={product.imageAlt ?? product.name}
              fill
              sizes="(max-width: 768px) 50vw, 340px"
              className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
              unoptimized
              priority={index === 0}
            />
            <span className="absolute inset-x-0 bottom-0 flex flex-col gap-xs bg-white/94 px-md py-sm">
              <span className="text-body4-medium tracking-[0.18em] text-gold uppercase">
                {department}
              </span>
              <span className="truncate">
                <Text as="span" variant="body3-medium">
                  {product.name}
                </Text>
              </span>
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
      className="grid items-center gap-2xl bg-gold-light p-lg sm:p-2xl md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:p-3xl"
    >
      <div className="flex flex-col items-start gap-lg">
        <Text as="p" variant="body3-medium">
          <span className="tracking-[0.2em] text-gold uppercase">The ShopSphere edit</span>
        </Text>
        <h1
          id="home-heading"
          className="font-serif text-heading2 leading-tight text-headings sm:text-heading1-5 lg:text-heading1"
        >
          Everyday essentials, delivered
        </h1>
        <p className="max-w-[30rem] text-body1 text-subtitles">
          Fashion, footwear, electronics and beauty from brands worth knowing. Every price is in ₹
          with GST included.
        </p>
        <div className="flex flex-wrap gap-sm">
          <ButtonLink href="/search?sort=newest" appearance="primary" size="lg">
            Shop new arrivals
          </ButtonLink>
          <ButtonLink href="/categories" appearance="default" size="lg">
            Explore categories
          </ButtonLink>
        </div>
      </div>
      <Suspense fallback={<Skeleton shape="block" height="lg" />}>
        <HeroShowcase />
      </Suspense>
    </section>
  );
}

async function TopCategories() {
  await connection();
  const categories = await getStorefrontCategoryTree();
  if (categories.length === 0) return null;
  return (
    <section aria-labelledby="top-categories" className="flex flex-col gap-xl">
      <SectionHeader
        id="top-categories"
        eyebrow="Departments"
        title="Shop by category"
        link={{ href: '/categories', label: 'All categories' }}
      />
      <ul className="grid grid-cols-2 gap-sm sm:gap-lg lg:grid-cols-4">
        {categories.map((category) => {
          const artUrl = categoryArtUrl(category.slug);
          return (
            <li key={category.id}>
              <NextLink
                href={`/categories/${category.slug}`}
                className={`group flex h-full flex-col bg-white ${focusRingClassNames}`}
              >
                <span className="relative block aspect-[4/5] w-full overflow-hidden bg-strokes">
                  {artUrl === null ? (
                    <span className="flex h-full items-center justify-center text-grey">
                      <Icon name="layers" size="lg" />
                    </span>
                  ) : (
                    <Image
                      src={artUrl}
                      alt=""
                      fill
                      sizes="(max-width: 1024px) 45vw, 280px"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      unoptimized
                    />
                  )}
                </span>
                <span className="flex flex-col gap-xs border border-t-0 border-lowlight p-md">
                  <span className="font-serif text-heading2-5 text-headings">{category.name}</span>
                  <Text as="span" variant="body3" tone="subtitle">
                    {category.children
                      .slice(0, 3)
                      .map((child) => child.name)
                      .join(' · ')}
                  </Text>
                  <span className="mt-xs inline-flex items-center gap-xs text-primary">
                    <Text as="span" variant="body3-medium" tone="primary">
                      Shop now
                    </Text>
                    <Icon name="arrow-right" size="xs" />
                  </span>
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
  const liveBanners = visibleNow(banners, now);
  if (liveBanners.length === 0 && liveCollections.length === 0) return null;
  return (
    <section aria-labelledby="collections" className="flex flex-col gap-xl">
      <SectionHeader id="collections" eyebrow="Curated" title="Featured collections" />
      <HomeBanners banners={liveBanners} />
      {liveCollections.length === 0 ? null : (
        <ul className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
          {liveCollections.map((collection) => (
            <li key={collection.id}>
              <NextLink
                href={`/collections/${collection.slug}`}
                className={`group flex h-full flex-col gap-xs border border-lowlight bg-white p-lg transition-colors hover:border-primary ${focusRingClassNames}`}
              >
                <span className="font-serif text-heading2-5 text-headings">{collection.name}</span>
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
      )}
    </section>
  );
}

async function NewArrivals() {
  await connection();
  const { hits } = await searchStorefront(browseQuery);
  return (
    <Shelf
      id="new-arrivals"
      eyebrow="Just in"
      title="New arrivals"
      products={hits}
      link={{ href: '/search?sort=newest&inStock=true', label: 'View all' }}
    />
  );
}

// Biggest real discounts (cheapest variant against its MRP), in stock.
async function TopDeals() {
  await connection();
  const { hits } = await searchStorefront({ ...browseQuery, sort: 'discount' });
  return (
    <Shelf
      id="top-deals"
      eyebrow="Best value"
      title="Top deals"
      products={hits.filter((hit) => hit.mrpPaise > hit.minPricePaise)}
      link={{ href: '/search?sort=discount&inStock=true', label: 'View all' }}
    />
  );
}

// From real orders only; hidden until there are some.
async function BestSellers() {
  await connection();
  const products = await findBestSellingProducts(8);
  return (
    <Shelf id="best-sellers" eyebrow="Most ordered" title="Best sellers" products={products} />
  );
}

async function UnderNineNinetyNine() {
  await connection();
  const { hits } = await searchStorefront({
    ...browseQuery,
    maxPricePaise: 99_900,
    sort: 'price_desc',
  });
  return (
    <Shelf
      id="under-999"
      eyebrow="Everyday favourites"
      title="Under ₹999"
      products={hits}
      link={{ href: '/search?maxPrice=999&inStock=true&sort=price_desc', label: 'View all' }}
    />
  );
}

function StorePromises() {
  return (
    <ul className="grid grid-cols-1 gap-lg border-y border-lowlight py-xl sm:grid-cols-3">
      {storePromises.map((storePromise) => (
        <li key={storePromise.title} className="flex items-start gap-md">
          <span className="inline-flex size-10 shrink-0 items-center justify-center border border-gold/40 text-gold">
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

const shelfFallback = <Skeleton shape="block" height="lg" />;

export default function StoreHomePage() {
  return (
    <StorePageFrame>
      <div className="flex flex-col gap-3xl">
        <Hero />
        <Suspense fallback={shelfFallback}>
          <TopCategories />
        </Suspense>
        <Suspense fallback={shelfFallback}>
          <NewArrivals />
        </Suspense>
        <Suspense fallback={shelfFallback}>
          <TopDeals />
        </Suspense>
        <Suspense fallback={shelfFallback}>
          <BestSellers />
        </Suspense>
        <Suspense fallback={shelfFallback}>
          <HomeMerchandising />
        </Suspense>
        <Suspense fallback={shelfFallback}>
          <UnderNineNinetyNine />
        </Suspense>
        <StorePromises />
      </div>
    </StorePageFrame>
  );
}
