import { Icon } from '@/components/atoms/Icon';
import { Link } from '@/components/atoms/Link';
import { mainContentId, SkipLink } from '@/components/atoms/SkipLink';
import { Text } from '@/components/atoms/Text';
import type { StoreLayoutProps } from './store-layout.types';

export function StoreLayout({
  storeName,
  navigationLinks,
  brand,
  headerSearch,
  headerActions,
  categoryNavigation,
  children,
}: StoreLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <div className="bg-nav-background">
        <p className="mx-auto flex w-full max-w-300 flex-wrap items-center justify-center gap-x-lg gap-y-xs px-lg py-xs text-center text-body3 text-white sm:justify-between">
          <span className="inline-flex items-center gap-xs">
            <Icon name="truck" size="xs" />
            Track every order from dispatch to delivery
          </span>
          <span className="hidden sm:inline">
            Pay online or Cash on Delivery · Prices in ₹, GST included
          </span>
        </p>
      </div>
      <header className="border-b border-lowlight bg-white shadow-sm">
        <div className="mx-auto flex w-full max-w-300 flex-wrap items-center justify-between gap-md px-lg py-md">
          {brand ?? (
            <Link href="/" appearance="plain" variant="body1-medium">
              {storeName}
            </Link>
          )}
          {headerSearch === undefined ? null : (
            <div className="order-last w-full md:order-none md:w-auto md:flex-1 md:px-xl">
              {headerSearch}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-lg">
            <nav aria-label="Primary">
              <ul className="flex flex-wrap items-center gap-lg">
                {navigationLinks.map((navigationLink) => (
                  <li key={navigationLink.href}>
                    <Link href={navigationLink.href} appearance="subtle">
                      {navigationLink.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            {headerActions}
          </div>
        </div>
        {categoryNavigation === undefined ? null : (
          <div className="border-t border-strokes">
            <div className="mx-auto w-full max-w-300 px-lg py-sm">{categoryNavigation}</div>
          </div>
        )}
      </header>
      <main
        id={mainContentId}
        tabIndex={-1}
        className="mx-auto w-full max-w-300 flex-1 px-lg py-xl outline-none"
      >
        {children}
      </main>
      <footer className="mt-3xl bg-nav-background text-white">
        <div className="mx-auto grid w-full max-w-300 grid-cols-1 gap-xl px-lg py-2xl sm:grid-cols-3">
          <div className="flex flex-col gap-sm">
            <Text as="p" variant="body1-medium" tone="inverse">
              {storeName}
            </Text>
            <Text as="p" variant="body3" tone="inverse">
              Electronics, fashion, footwear and beauty from brands you trust, delivered across
              India.
            </Text>
          </div>
          <nav aria-label="Shop" className="flex flex-col gap-sm">
            <Text as="p" variant="body2-medium" tone="inverse">
              Shop
            </Text>
            <Link href="/categories" appearance="inverse" variant="body3">
              Explore the catalogue
            </Link>
            <Link href="/search" appearance="inverse" variant="body3">
              Search products
            </Link>
          </nav>
          <nav aria-label="Help" className="flex flex-col gap-sm">
            <Text as="p" variant="body2-medium" tone="inverse">
              Help
            </Text>
            <Link href="/orders" appearance="inverse" variant="body3">
              Track your orders
            </Link>
            <Link href="/account" appearance="inverse" variant="body3">
              Account settings
            </Link>
            <Link href="/cart" appearance="inverse" variant="body3">
              View your cart
            </Link>
          </nav>
        </div>
        <div className="border-t border-nav-group">
          <Text as="p" variant="body3" tone="inverse">
            <span className="mx-auto block w-full max-w-300 px-lg py-md opacity-80">
              © {storeName} · Prices in INR, inclusive of GST
            </span>
          </Text>
        </div>
      </footer>
    </div>
  );
}
