import { Icon } from '@/components/atoms/Icon';
import { Link } from '@/components/atoms/Link';
import { mainContentId, SkipLink } from '@/components/atoms/SkipLink';
import { Text } from '@/components/atoms/Text';
import type { StoreLayoutProps } from './store-layout.types';

const footerHeadingClassNames = 'text-body3-medium tracking-[0.18em] text-gold uppercase';

export function StoreLayout({
  storeName,
  navigationLinks,
  brand,
  headerSearch,
  headerActions,
  categoryNavigation,
  fullWidth = false,
  children,
}: StoreLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <div className="bg-nav-background">
        <p className="mx-auto flex w-full max-w-300 flex-wrap items-center justify-center gap-x-xl gap-y-xs px-lg py-xs text-center text-body4-medium tracking-[0.14em] text-white/90 uppercase sm:justify-between">
          <span className="inline-flex items-center gap-xs">
            <Icon name="truck" size="xs" />
            Track every order from dispatch to delivery
          </span>
          <span className="hidden sm:inline">
            Pay online or Cash on Delivery · Prices in ₹, GST included
          </span>
        </p>
      </div>
      <header className="border-b border-lowlight bg-background/95 backdrop-blur md:sticky md:top-0 md:z-30">
        {/* Phones: wordmark and icons on one row, search below. Desktop: search, centred wordmark, icons. */}
        <div className="mx-auto grid w-full max-w-300 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-md gap-y-sm px-lg py-md lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:py-lg">
          <div className="col-start-1 row-start-1 lg:col-start-2 lg:justify-self-center">
            {brand ?? (
              <Link href="/" appearance="plain" variant="body1-medium">
                {storeName}
              </Link>
            )}
          </div>
          {headerSearch === undefined ? null : (
            <div className="col-span-2 row-start-2 lg:col-span-1 lg:col-start-1 lg:row-start-1 lg:max-w-80">
              {headerSearch}
            </div>
          )}
          <div className="col-start-2 row-start-1 flex items-center justify-end gap-lg lg:col-start-3">
            <nav aria-label="Primary">
              <ul className="flex items-center gap-lg">
                {navigationLinks.map((navigationLink) => (
                  <li
                    key={navigationLink.href}
                    className={
                      navigationLink.hideOnSmallScreens === true ? 'hidden sm:list-item' : ''
                    }
                  >
                    <Link
                      href={navigationLink.href}
                      appearance="subtle"
                      aria-label={navigationLink.label}
                    >
                      <span className="inline-flex items-center gap-xs">
                        {navigationLink.icon === undefined ? null : (
                          <Icon name={navigationLink.icon} size="sm" />
                        )}
                        <span
                          className={navigationLink.icon === undefined ? '' : 'hidden xl:inline'}
                        >
                          {navigationLink.label}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            {headerActions}
          </div>
        </div>
        {categoryNavigation === undefined ? null : (
          <div className="border-t border-lowlight">
            <div className="mx-auto w-full max-w-300 px-lg py-sm">{categoryNavigation}</div>
          </div>
        )}
      </header>
      <main
        id={mainContentId}
        tabIndex={-1}
        className={
          fullWidth
            ? 'w-full flex-1 outline-none'
            : 'mx-auto w-full max-w-300 flex-1 px-lg py-xl outline-none'
        }
      >
        {children}
      </main>
      <footer className={`bg-nav-background text-white ${fullWidth ? '' : 'mt-3xl'}`}>
        <div className="mx-auto grid w-full max-w-300 grid-cols-1 gap-2xl px-lg py-3xl sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <div className="flex flex-col gap-md">
            <p className="font-serif text-heading2 text-white">{storeName}</p>
            <Text as="p" variant="body2" tone="inverse">
              <span className="block max-w-80 opacity-80">
                Fashion, footwear, beauty and electronics, chosen with care and delivered across
                India.
              </span>
            </Text>
          </div>
          <nav aria-label="Shop" className="flex flex-col gap-sm">
            <p className={footerHeadingClassNames}>Shop</p>
            <Link href="/categories" appearance="inverse" variant="body3">
              Explore the catalogue
            </Link>
            <Link href="/search" appearance="inverse" variant="body3">
              Search products
            </Link>
            <Link href="/credits" appearance="inverse" variant="body3">
              Photo credits
            </Link>
          </nav>
          <nav aria-label="Help" className="flex flex-col gap-sm">
            <p className={footerHeadingClassNames}>Help</p>
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
          <div className="flex flex-col gap-sm">
            <p className={footerHeadingClassNames}>Shopping with us</p>
            <Text as="p" variant="body3" tone="inverse">
              <span className="opacity-80">Prices in ₹, inclusive of GST.</span>
            </Text>
            <Text as="p" variant="body3" tone="inverse">
              <span className="opacity-80">Check delivery for your pincode on every product.</span>
            </Text>
            <Text as="p" variant="body3" tone="inverse">
              <span className="opacity-80">Cash on Delivery where it is offered.</span>
            </Text>
          </div>
        </div>
        <div className="border-t border-nav-group">
          <Text as="p" variant="body3" tone="inverse">
            <span className="mx-auto block w-full max-w-300 px-lg py-md opacity-70">
              © {storeName} · Prices in INR, inclusive of GST
            </span>
          </Text>
        </div>
      </footer>
    </div>
  );
}
