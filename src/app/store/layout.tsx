import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/atoms/Toast';
import { ThemeProvider } from '@/theme';
import { storeName } from './store-shell';
import '../globals.css';

export const metadata: Metadata = {
  title: { default: storeName, template: `%s · ${storeName}` },
  description: 'Shop the catalogue and pay with Cash on Delivery.',
};

export default function StoreRootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en-IN" className={GeistSans.variable}>
      <body className="bg-background font-sans text-headings antialiased">
        <ThemeProvider surface="store" storeBranding={null}>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
