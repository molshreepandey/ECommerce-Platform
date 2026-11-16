import Image from 'next/image';
import NextLink from 'next/link';
import { connection } from 'next/server';
import { type ReactNode, Suspense } from 'react';
import { ButtonLink } from '@/components/atoms/Button';
import { focusRingClassNames } from '@/components/atoms/focus-ring';
import { Icon, type IconName } from '@/components/atoms/Icon';
import { Skeleton } from '@/components/atoms/Skeleton';
import { HomeBanners } from '@/components/organisms/Merchandising';
import { isNotFoundError } from '@/lib/errors';
import { Money } from '@/lib/money';
import {
  categoryArtUrl,
  displayImageUrl,
  productPhotoUrl,
} from '@/modules/catalogue/catalogue-art';
import { getHomeMerchandising } from '@/modules/merchandising/merchandising.cache';
import {
  loadStorefrontCollection,
  visibleNow,
} from '@/modules/merchandising/merchandising.service';
import type { ProductSearchHit, ProductSearchQuery } from '@/modules/search/product-search.schema';
import { findBestSellingProducts } from '@/modules/storefront/best-sellers.service';
import { searchStorefront } from '@/modules/storefront/storefront-search.service';
import { getStorefrontCategoryTree } from '@/modules/taxonomy/storefront-category.cache';
import type { StorefrontCategory } from '@/modules/taxonomy/storefront-category.service';
import { StorePageFrame } from './store-page-frame';

// The home page: a full-bleed editorial layout built only from the live catalogue. Every picture is a real
// product's own photograph (products still shown as drawings are left out here), every link goes to that
// product, category or collection, and nothing is claimed that the store does not do.

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

const container = 'mx-auto w-full max-w-300 px-lg';
const eyebrow = 'text-body3-medium tracking-[0.22em] text-gold uppercase';
const displayHeading = 'font-serif text-headings leading-[1.05]';

const rupees = (paise: number) => Money.formatRupees(Money.fromPaise(paise));
// The picture for a product on this page: its bundled photograph, else the image an admin gave it; never
// one of the bundled drawings (a product with only a drawing is left out of the picture-led sections).
function realImageOf(product: Readonly<{ slug: string; imageUrl: string | null }>): string | null {
  const photo = productPhotoUrl(product.slug);
  if (photo !== null) return photo;
  if (product.imageUrl === null) return null;
  const shown = displayImageUrl(product.imageUrl);
  return shown.startsWith('/catalogue-art/') ? null : shown;
}
const hasRealImage = (hit: ProductSearchHit) => realImageOf(hit) !== null;

// The hero picture: the first of these that is on sale and photographed, else any photographed apparel.
const heroPreference = [
  'anarkali-kurta-rust-print',
  'anarkali-kurta-emerald-print',
  'banarasi-silk-saree',
] as const;

async function inCategory(slug: string, query: Partial<ProductSearchQuery> = {}) {
  try {
    return (await searchStorefront({ ...browseQuery, categorySlug: slug, ...query })).hits;
  } catch (error) {
    // A department that does not exist (or is inactive) is simply left out; other failures surface.
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

function SectionHeading({
  id,
  kicker,
  title,
  action,
}: Readonly<{ id: string; kicker: string; title: string; action?: ReactNode }>) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-md">
      <div className="flex flex-col gap-sm">
        <p className={eyebrow}>{kicker}</p>
        <h2 id={id} className={`${displayHeading} text-heading2 sm:text-[2.75rem]`}>
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

function TextLink({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <NextLink
      href={href}
      className={`group inline-flex items-center gap-sm border-b border-headings pb-xs text-body2-medium tracking-[0.12em] text-headings uppercase transition-colors hover:border-primary hover:text-primary ${focusRingClassNames}`}
    >
      {children}
      <span className="transition-transform duration-300 group-hover:translate-x-1">
        <Icon name="arrow-right" size="xs" />
      </span>
    </NextLink>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────────────────────────────────

async function HeroImage() {
  await connection();
  const apparel = (await inCategory('apparel')).filter(hasRealImage);
  const pick =
    heroPreference
      .map((slug) => apparel.find((hit) => hit.slug === slug))
      .find((hit) => hit !== undefined) ?? apparel[0];
  if (pick === undefined) return <div className="h-full w-full bg-strokes" />;
  return (
    <NextLink
      href={`/products/${pick.slug}`}
      className={`group relative block h-full overflow-hidden bg-strokes md:min-h-[28rem] ${focusRingClassNames}`}
    >
      <Image
        src={realImageOf(pick) ?? ''}
        alt={pick.imageAlt ?? pick.name}
        fill
        priority
        sizes="(max-width: 768px) 100vw, 60vw"
        className="object-cover object-[50%_30%] transition-transform duration-[1200ms] ease-out group-hover:scale-[1.02]"
        unoptimized
      />
      <span className="absolute bottom-lg left-lg hidden flex-col gap-xs bg-background/95 px-lg py-md sm:flex">
        <span className="text-body4-medium tracking-[0.2em] text-gold uppercase">In the edit</span>
        <span className="font-serif text-heading2-5 text-headings">{pick.name}</span>
        <span className="text-body3 text-subtitles">From {rupees(pick.minPricePaise)}</span>
      </span>
    </NextLink>
  );
}

function Hero() {
  return (
    <section
      aria-labelledby="home-heading"
      className="grid bg-gold-light md:min-h-[min(86vh,52rem)] md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
    >
      <div className="relative h-[56vh] min-h-[22rem] md:h-auto">
        <Suspense fallback={<div className="h-full w-full bg-strokes" />}>
          <HeroImage />
        </Suspense>
      </div>
      <div className="flex flex-col justify-center gap-lg px-lg py-2xl sm:gap-xl sm:px-2xl sm:py-3xl lg:px-[4.5rem]">
        <p className={`${eyebrow} animate-rise-in`}>The ShopSphere edit</p>
        <h1
          id="home-heading"
          className={`${displayHeading} animate-rise-in text-[2.75rem] sm:text-[3.75rem] lg:text-[4.75rem]`}
        >
          Everyday essentials, delivered
        </h1>
        <p className="animate-rise-in max-w-[26rem] text-body1 leading-relaxed text-subtitles">
          Considered fashion, footwear, beauty and electronics from brands worth knowing. Every
          price in ₹, GST included.
        </p>
        <div className="animate-rise-in flex flex-wrap items-center gap-lg">
          <ButtonLink href="/categories/apparel" appearance="primary" size="lg">
            Discover the edit
          </ButtonLink>
          <TextLink href="/search?sort=newest">New arrivals</TextLink>
        </div>
      </div>
    </section>
  );
}

// ─── Departments ─────────────────────────────────────────────────────────────────────────────────────

// Large tile first; any further department gets a regular tile. On wide screens the rows have a fixed
// height but the grid grows, so a fifth department adds a row instead of spilling over the next section.
const regularDepartmentTile = 'aspect-[4/5] lg:col-span-3 lg:aspect-auto';
const departmentTiles: Readonly<Record<string, string>> = {
  apparel: 'col-span-2 aspect-[4/3] lg:col-span-6 lg:row-span-2 lg:aspect-auto',
  footwear: 'col-span-2 aspect-[16/9] lg:col-span-6 lg:aspect-auto',
  beauty: regularDepartmentTile,
  electronics: regularDepartmentTile,
};
const departmentOrder = ['apparel', 'footwear', 'beauty', 'electronics'];

function DepartmentTile({ category }: Readonly<{ category: StorefrontCategory }>) {
  const picture = categoryArtUrl(category.slug);
  return (
    <li className={`relative ${departmentTiles[category.slug] ?? regularDepartmentTile}`}>
      <NextLink
        href={`/categories/${category.slug}`}
        className={`group absolute inset-0 block overflow-hidden bg-strokes ${focusRingClassNames}`}
      >
        {picture === null ? null : (
          <Image
            src={picture}
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
            unoptimized
          />
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-headings/70 via-headings/10 to-transparent" />
        <span className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-xs p-lg sm:p-xl">
          <span className="font-serif text-heading2 text-white sm:text-[2.25rem]">
            {category.name}
          </span>
          <span className="text-body3 text-white/85">
            {category.children
              .slice(0, 3)
              .map((child) => child.name)
              .join(' · ')}
          </span>
          <span className="mt-xs inline-flex items-center gap-xs border-b border-white/70 pb-xs text-body4-medium tracking-[0.16em] text-white uppercase">
            Explore
            <Icon name="arrow-right" size="xs" />
          </span>
        </span>
      </NextLink>
    </li>
  );
}

async function Departments() {
  await connection();
  const categories = await getStorefrontCategoryTree();
  if (categories.length === 0) return null;
  const ordered = [...categories].sort(
    (left, right) =>
      (departmentOrder.indexOf(left.slug) + 1 || 99) -
      (departmentOrder.indexOf(right.slug) + 1 || 99),
  );
  return (
    <section
      aria-labelledby="top-categories"
      className={`${container} flex flex-col gap-2xl py-3xl lg:py-[6rem]`}
    >
      <SectionHeading
        id="top-categories"
        kicker="Departments"
        title="Shop by category"
        action={<TextLink href="/categories">All categories</TextLink>}
      />
      <ul className="grid grid-cols-2 gap-sm sm:gap-md lg:auto-rows-[22.5rem] lg:grid-cols-12">
        {ordered.map((category) => (
          <DepartmentTile key={category.id} category={category} />
        ))}
      </ul>
    </section>
  );
}

// ─── Product rows ────────────────────────────────────────────────────────────────────────────────────

function EditorialProduct({ product }: Readonly<{ product: ProductSearchHit }>) {
  return (
    <li>
      <NextLink
        href={`/products/${product.slug}`}
        className={`group flex flex-col gap-md ${focusRingClassNames}`}
      >
        <span className="relative block aspect-[4/5] overflow-hidden bg-white">
          <Image
            src={realImageOf(product) ?? ''}
            alt={product.imageAlt ?? product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
            unoptimized
          />
        </span>
        <span className="flex flex-col gap-xs">
          <span className="text-body4-medium tracking-[0.16em] text-subtitles uppercase">
            {product.brandName}
          </span>
          <span className="text-body2 text-headings underline-offset-4 group-hover:underline">
            {product.name}
          </span>
          <span className="text-body2-medium text-headings">
            From {rupees(product.minPricePaise)}
          </span>
        </span>
      </NextLink>
    </li>
  );
}

function ProductRow({
  id,
  kicker,
  title,
  products,
  href,
}: Readonly<{
  id: string;
  kicker: string;
  title: string;
  products: readonly ProductSearchHit[];
  href?: string;
}>) {
  if (products.length === 0) return null;
  return (
    <section aria-labelledby={id} className={`${container} flex flex-col gap-2xl py-3xl`}>
      <SectionHeading
        id={id}
        kicker={kicker}
        title={title}
        {...(href === undefined ? {} : { action: <TextLink href={href}>Shop all</TextLink> })}
      />
      <ul
        aria-label={title}
        className="grid grid-cols-2 gap-x-md gap-y-2xl lg:grid-cols-4 lg:gap-x-lg"
      >
        {products.slice(0, 4).map((product) => (
          <EditorialProduct key={product.productId} product={product} />
        ))}
      </ul>
    </section>
  );
}

async function NewArrivals() {
  await connection();
  const { hits } = await searchStorefront(browseQuery);
  return (
    <ProductRow
      id="new-arrivals"
      kicker="Just in"
      title="New arrivals"
      products={hits.filter(hasRealImage)}
      href="/search?sort=newest&inStock=true"
    />
  );
}

// From real orders only; hidden until there are at least four photographed best sellers.
async function BestSellers() {
  await connection();
  const products = (await findBestSellingProducts(12)).filter(hasRealImage);
  // A full row or nothing: a single best seller reads as an empty shelf.
  if (products.length < 4) return null;
  return (
    <ProductRow id="best-sellers" kicker="Most ordered" title="Best sellers" products={products} />
  );
}

// ─── Campaigns (the live collections) ────────────────────────────────────────────────────────────────

// Products whose photograph makes the strongest cover for a collection that contains them.
const campaignCoverPreference: readonly string[] = ['banarasi-silk-saree', 'nimbus-air-14-laptop'];

async function Campaigns() {
  await connection();
  const { collections } = await getHomeMerchandising();
  const loaded = await Promise.all(
    visibleNow(collections, new Date()).map(async (collection) => {
      try {
        return await loadStorefrontCollection(collection.slug);
      } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
      }
    }),
  );
  const live = loaded.filter((collection) => collection !== null);
  if (live.length === 0) return null;
  // The first two get a full spread; every other live collection is still linked below them.
  const spreads = live.slice(0, 2).map((collection) => {
    const pictured = collection.products.filter((product) => realImageOf(product) !== null);
    const cover =
      pictured.find((product) => campaignCoverPreference.includes(product.slug)) ?? pictured[0];
    return { ...collection, cover, listed: collection.products.slice(0, 4) };
  });
  const others = live.slice(2);
  return (
    <section aria-labelledby="collections" className="flex flex-col">
      <h2 id="collections" className="sr-only">
        Featured collections
      </h2>
      {spreads.map((campaign, index) => (
        <article
          key={campaign.slug}
          aria-labelledby={`campaign-${campaign.slug}`}
          className={`grid ${campaign.cover === undefined ? '' : 'md:min-h-[38rem] md:grid-cols-2'} ${index % 2 === 0 ? 'bg-white' : 'bg-gold-light'}`}
        >
          {campaign.cover === undefined ? null : (
            <NextLink
              href={`/collections/${campaign.slug}`}
              tabIndex={-1}
              aria-hidden="true"
              className={`group relative block aspect-[4/5] overflow-hidden bg-strokes md:aspect-auto ${index % 2 === 0 ? '' : 'md:order-2'}`}
            >
              <Image
                src={realImageOf(campaign.cover) ?? ''}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.03]"
                unoptimized
              />
            </NextLink>
          )}
          <div className="flex flex-col justify-center gap-lg px-lg py-3xl sm:px-2xl lg:px-[5rem]">
            <p className={eyebrow}>The collection</p>
            <h3
              id={`campaign-${campaign.slug}`}
              className={`${displayHeading} text-heading2 sm:text-[3rem]`}
            >
              <NextLink
                href={`/collections/${campaign.slug}`}
                className={`hover:text-primary ${focusRingClassNames}`}
              >
                {campaign.name}
              </NextLink>
            </h3>
            {campaign.description.trim() === '' ? null : (
              <p className="max-w-[28rem] text-body1 leading-relaxed text-subtitles">
                {campaign.description}
              </p>
            )}
            {campaign.listed.length === 0 ? null : (
              <ul className="flex max-w-[34rem] flex-col divide-y divide-lowlight border-y border-lowlight">
                {campaign.listed.map((product) => (
                  <li key={product.productId}>
                    <NextLink
                      href={`/products/${product.slug}`}
                      className={`flex items-center justify-between gap-md py-sm text-body2 text-headings hover:text-primary ${focusRingClassNames}`}
                    >
                      <span>{product.name}</span>
                      <span className="text-subtitles">From {rupees(product.minPricePaise)}</span>
                    </NextLink>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <TextLink href={`/collections/${campaign.slug}`}>Shop the collection</TextLink>
            </div>
          </div>
        </article>
      ))}
      {others.length === 0 ? null : (
        <div className={`${container} flex flex-col gap-lg py-3xl`}>
          <p className={eyebrow}>More collections</p>
          <ul className="flex flex-wrap gap-x-2xl gap-y-md">
            {others.map((collection) => (
              <li key={collection.slug}>
                <NextLink
                  href={`/collections/${collection.slug}`}
                  className={`font-serif text-heading2-5 text-headings underline-offset-8 hover:text-primary hover:underline ${focusRingClassNames}`}
                >
                  {collection.name}
                </NextLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// Banners an admin added with a real picture (the demo banners are drawings, so they stay off this page).
async function PhotoBanners() {
  await connection();
  const { banners } = await getHomeMerchandising();
  const withPhotos = visibleNow(banners, new Date()).filter(
    (banner) => !displayImageUrl(banner.imageUrl).startsWith('/catalogue-art/'),
  );
  if (withPhotos.length === 0) return null;
  return (
    <div className={`${container} py-3xl`}>
      <HomeBanners banners={withPhotos} />
    </div>
  );
}

// ─── Brand story and services ────────────────────────────────────────────────────────────────────────

const services: readonly { title: string; description: string; icon: IconName }[] = [
  {
    title: 'Delivery you can check',
    description: 'Enter your pincode on any product to see whether, and when, we deliver there.',
    icon: 'map-pin',
  },
  {
    title: 'Pay the way you like',
    description: 'Pay online, or with Cash on Delivery where it is offered for your pincode.',
    icon: 'credit-card',
  },
  {
    title: 'Follow every parcel',
    description: 'Track each shipment from dispatch to your door in your orders.',
    icon: 'truck',
  },
];

function BrandStory() {
  return (
    <section aria-labelledby="brand-story" className="bg-nav-background text-white">
      <div
        className={`${container} grid gap-3xl py-[5rem] lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:py-[7rem]`}
      >
        <div className="flex flex-col gap-lg">
          <p className={eyebrow}>Our approach</p>
          <h2
            id="brand-story"
            className="font-serif text-[2.25rem] leading-[1.1] text-white sm:text-[3.25rem]"
          >
            Fewer, better things — chosen with care.
          </h2>
          <p className="max-w-[34rem] text-body1 leading-relaxed text-white/80">
            ShopSphere brings clothing, footwear, beauty and electronics together in one considered
            store. Prices are shown in rupees with GST already included; delivery and any Cash on
            Delivery fee are shown at checkout before you place your order.
          </p>
          <div>
            <NextLink
              href="/categories"
              className={`group inline-flex items-center gap-sm border-b border-white pb-xs text-body2-medium tracking-[0.12em] text-white uppercase hover:border-gold hover:text-gold ${focusRingClassNames}`}
            >
              Explore the store
              <span className="transition-transform duration-300 group-hover:translate-x-1">
                <Icon name="arrow-right" size="xs" />
              </span>
            </NextLink>
          </div>
        </div>
        <ul className="flex flex-col divide-y divide-white/15 self-end border-y border-white/15">
          {services.map((service) => (
            <li key={service.title} className="flex items-start gap-lg py-lg">
              <span className="mt-xs text-gold">
                <Icon name={service.icon} size="sm" />
              </span>
              <span className="flex flex-col gap-xs">
                <span className="font-serif text-heading2-5 text-white">{service.title}</span>
                <span className="text-body3 text-white/75">{service.description}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const sectionFallback = (
  <div className={`${container} py-3xl`}>
    <Skeleton shape="block" height="lg" />
  </div>
);

export default function StoreHomePage() {
  return (
    <StorePageFrame fullWidth>
      <Hero />
      <Suspense fallback={sectionFallback}>
        <Departments />
      </Suspense>
      <Suspense fallback={sectionFallback}>
        <NewArrivals />
      </Suspense>
      <Suspense fallback={sectionFallback}>
        <Campaigns />
      </Suspense>
      <Suspense fallback={sectionFallback}>
        <BestSellers />
      </Suspense>
      <Suspense fallback={sectionFallback}>
        <PhotoBanners />
      </Suspense>
      <BrandStory />
    </StorePageFrame>
  );
}
