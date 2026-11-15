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
      <header className="border-b border-lowlight bg-white">
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
      <footer className="border-t border-lowlight bg-white">
        <div className="mx-auto w-full max-w-300 px-lg py-lg">
          <Text variant="body3" tone="muted">
            {storeName} · Prices in INR, inclusive of GST
          </Text>
        </div>
      </footer>
    </div>
  );
}
