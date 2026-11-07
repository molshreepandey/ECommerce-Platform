import type { DiscountType } from '../../src/generated/prisma/enums';
import type { SeedClient } from './seed-client';
import { daysFromSeedDay } from './seed-clock';

interface CouponSeed {
  code: string;
  description: string;
  discountType: DiscountType;
  discountValue: number;
  maxDiscountPaise: number | null;
  minCartPaise: number;
  validFromDay: number;
  validUntilDay: number;
  totalUsageLimit: number | null;
  perCustomerLimit: number | null;
  firstOrderOnly: boolean;
  externallyUsedCount: number;
}

export const validCouponCode = 'SAVE10';

const couponSeeds: readonly CouponSeed[] = [
  {
    code: validCouponCode,
    description: '10% off up to ₹200 on orders above ₹999',
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscountPaise: 20000,
    minCartPaise: 99900,
    validFromDay: -30,
    validUntilDay: 365,
    totalUsageLimit: 1000,
    perCustomerLimit: 3,
    firstOrderOnly: false,
    externallyUsedCount: 0,
  },
  {
    code: 'FLAT150',
    description: '₹150 off on orders above ₹799 (expired)',
    discountType: 'FLAT',
    discountValue: 15000,
    maxDiscountPaise: null,
    minCartPaise: 79900,
    validFromDay: -60,
    validUntilDay: -1,
    totalUsageLimit: null,
    perCustomerLimit: 1,
    firstOrderOnly: false,
    externallyUsedCount: 0,
  },
  {
    code: 'BIGSALE25',
    description: '25% off up to ₹500 (usage limit reached)',
    discountType: 'PERCENT',
    discountValue: 25,
    maxDiscountPaise: 50000,
    minCartPaise: 0,
    validFromDay: -7,
    validUntilDay: 30,
    totalUsageLimit: 100,
    perCustomerLimit: 1,
    firstOrderOnly: false,
    externallyUsedCount: 100,
  },
  {
    code: 'WELCOME20',
    description: '20% off up to ₹300 on your first order',
    discountType: 'PERCENT',
    discountValue: 20,
    maxDiscountPaise: 30000,
    minCartPaise: 0,
    validFromDay: -90,
    validUntilDay: 365,
    totalUsageLimit: null,
    perCustomerLimit: 1,
    firstOrderOnly: true,
    externallyUsedCount: 0,
  },
];

export async function seedCoupons(client: SeedClient): Promise<Map<string, string>> {
  const couponIdByCode = new Map<string, string>();
  for (const couponSeed of couponSeeds) {
    const couponFields = {
      description: couponSeed.description,
      discountType: couponSeed.discountType,
      discountValue: couponSeed.discountValue,
      maxDiscountPaise: couponSeed.maxDiscountPaise,
      minCartPaise: couponSeed.minCartPaise,
      validFrom: daysFromSeedDay(couponSeed.validFromDay),
      validUntil: daysFromSeedDay(couponSeed.validUntilDay),
      totalUsageLimit: couponSeed.totalUsageLimit,
      perCustomerLimit: couponSeed.perCustomerLimit,
      firstOrderOnly: couponSeed.firstOrderOnly,
      usedCount: couponSeed.externallyUsedCount,
    };
    const coupon = await client.coupon.upsert({
      where: { code: couponSeed.code },
      create: { code: couponSeed.code, ...couponFields },
      update: couponFields,
      select: { id: true },
    });
    couponIdByCode.set(couponSeed.code, coupon.id);
  }
  return couponIdByCode;
}
