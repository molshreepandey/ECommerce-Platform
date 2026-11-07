import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import type { StoreLayoutProps } from './store-layout.types';

export function StoreLayout({ storeName, navigationLinks, children }: StoreLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-lowlight bg-white">
        <div className="mx-auto flex w-full max-w-300 flex-wrap items-center justify-between gap-md px-lg py-md">
          <Link href="/" appearance="plain" variant="body1-medium">
            {storeName}
          </Link>
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
        </div>
      </header>
      <main className="mx-auto w-full max-w-300 flex-1 px-lg py-xl">{children}</main>
      <footer className="border-t border-lowlight bg-white">
        <div className="mx-auto w-full max-w-300 px-lg py-lg">
          <Text variant="body3" tone="muted">
            {storeName} · Cash on Delivery across serviceable pincodes
          </Text>
        </div>
      </footer>
    </div>
  );
}
