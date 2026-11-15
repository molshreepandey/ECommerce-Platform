import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BannerManager } from '@/components/organisms/Merchandising';
import { isWithinWindow } from '@/modules/merchandising/merchandising.schema';
import { listBanners } from '@/modules/merchandising/merchandising.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';

export const metadata: Metadata = { title: 'Banners' };

export default function BannersPage() {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/banners"
        title="Home banners"
        readPermission="catalogue.read"
        writePermission="merchandising.write"
      >
        {async ({ staff, canWrite }) => {
          const now = new Date();
          const banners = await listBanners(staff);
          return (
            <BannerManager
              canWrite={canWrite}
              banners={banners.map((banner) => ({
                ...banner,
                startsAt: banner.startsAt?.toISOString() ?? null,
                endsAt: banner.endsAt?.toISOString() ?? null,
                isLive: isWithinWindow(banner, now),
              }))}
            />
          );
        }}
      </AdminPageFrame>
    </Suspense>
  );
}
