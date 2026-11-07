import type { Metadata } from 'next';

import { AdminNotFoundView, adminNotFoundTitle } from './admin-not-found-view';

export const metadata: Metadata = { title: adminNotFoundTitle };

export default function AdminNotFoundPage() {
  return <AdminNotFoundView />;
}
