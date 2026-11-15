import { Heading } from '@/components/atoms/Heading';
import { mainContentId, SkipLink } from '@/components/atoms/SkipLink';
import { AdminSidenav } from './AdminSidenav';
import type { AdminLayoutProps } from './admin-layout.types';

export function AdminLayout({ navigationItems, title, headerActions, children }: AdminLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <SkipLink />
      <AdminSidenav navigationItems={navigationItems} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-md border-b border-lowlight bg-white px-lg py-md">
          <Heading level={1} variant="heading3">
            {title}
          </Heading>
          {headerActions}
        </header>
        <main id={mainContentId} tabIndex={-1} className="flex-1 p-lg outline-none md:p-xl">
          {children}
        </main>
      </div>
    </div>
  );
}
