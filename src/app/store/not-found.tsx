import type { Metadata } from 'next';

import { StoreNotFoundView, storeNotFoundTitle } from './store-not-found-view';

export const metadata: Metadata = { title: storeNotFoundTitle };

export default function StoreNotFoundPage() {
  return <StoreNotFoundView />;
}
