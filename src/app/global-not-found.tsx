import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Suspense } from 'react';

import { Flexbox } from '@/components/atoms/Flexbox';
import { Spinner } from '@/components/atoms/Spinner';
import { ToastProvider } from '@/components/atoms/Toast';
import { SURFACE_HEADER } from '@/lib/request-headers';
import { ThemeProvider } from '@/theme';

import { AdminNotFoundView } from './admin/admin-not-found-view';
import { storeName } from './store/store-shell';
import { StoreNotFoundView } from './store/store-not-found-view';
import './globals.css';

type Surface = 'store' | 'admin';

const notFoundTitleBySurface: Record<Surface, string> = {
  store: `Page not found · ${storeName}`,
  admin: 'Page not found · Admin',
};

async function readSurface(): Promise<Surface> {
  return (await headers()).get(SURFACE_HEADER) === 'admin' ? 'admin' : 'store';
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: notFoundTitleBySurface[await readSurface()] };
}

async function SurfaceNotFoundView() {
  const surface = await readSurface();
  return (
    <ThemeProvider surface={surface} storeBranding={null}>
      <ToastProvider>
        {surface === 'admin' ? <AdminNotFoundView /> : <StoreNotFoundView />}
      </ToastProvider>
    </ThemeProvider>
  );
}

function NotFoundLoadingFallback() {
  return (
    <Flexbox as="main" direction="column" align="center" justify="center" padding="3xl">
      <Spinner size="lg" label="Loading" />
    </Flexbox>
  );
}

export default function GlobalNotFoundPage() {
  return (
    <html lang="en-IN" className={GeistSans.variable}>
      <body className="bg-background font-sans text-headings antialiased">
        <Suspense fallback={<NotFoundLoadingFallback />}>
          <SurfaceNotFoundView />
        </Suspense>
      </body>
    </html>
  );
}
