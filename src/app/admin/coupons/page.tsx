import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CouponManager } from '@/components/organisms/PricingAdmin';
import { listCoupons } from '@/modules/pricing/coupon.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';

export const metadata: Metadata = { title: 'Coupons' };

export default function CouponsPage() {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/coupons"
        title="Coupons"
        readPermission="coupons.write"
        writePermission="coupons.write"
      >
        {async ({ staff, canWrite }) => {
          const coupons = await listCoupons(staff);
          return (
            <CouponManager
              canWrite={canWrite}
              renderedAt={new Date().toISOString()}
              coupons={coupons.map((coupon) => ({
                ...coupon,
                validFrom: coupon.validFrom.toISOString(),
                validUntil: coupon.validUntil.toISOString(),
              }))}
            />
          );
        }}
      </AdminPageFrame>
    </Suspense>
  );
}
