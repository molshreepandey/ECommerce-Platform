import type { Prisma } from '@/generated/prisma/client';
import type { DatabaseClient } from '@/lib/db';

export const couponTermsSelect = {
  id: true,
  code: true,
  description: true,
  discountType: true,
  discountValue: true,
  maxDiscountPaise: true,
  minCartPaise: true,
  validFrom: true,
  validUntil: true,
  totalUsageLimit: true,
  perCustomerLimit: true,
  firstOrderOnly: true,
  usedCount: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.CouponSelect;

export type CouponRow = Prisma.CouponGetPayload<{ select: typeof couponTermsSelect }>;

export function findCouponByCode(database: DatabaseClient, code: string) {
  return database.coupon.findUnique({ where: { code }, select: couponTermsSelect });
}

export function findCouponById(database: DatabaseClient, couponId: string) {
  return database.coupon.findUnique({ where: { id: couponId }, select: couponTermsSelect });
}

export function countCouponRedemptionsForCustomer(
  database: DatabaseClient,
  couponId: string,
  customerId: string,
): Promise<number> {
  return database.couponRedemption.count({ where: { couponId, customerId } });
}

// Guarded increment (plan §10A rule 6): 0 rows means the coupon ran out between the check and the order.
export async function incrementCouponUsage(
  database: DatabaseClient,
  couponId: string,
): Promise<boolean> {
  const updated = await database.$executeRaw`
    UPDATE coupons SET used_count = used_count + 1, updated_at = now()
    WHERE id = ${couponId}::uuid AND (total_usage_limit IS NULL OR used_count < total_usage_limit)`;
  return updated === 1;
}

export function insertCouponRedemption(
  database: DatabaseClient,
  redemption: { couponId: string; customerId: string; orderId: string; discountPaise: number },
) {
  return database.couponRedemption.create({ data: redemption, select: { id: true } });
}

export function listCouponRows(database: DatabaseClient) {
  return database.coupon.findMany({
    select: couponTermsSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

export function insertCoupon(database: DatabaseClient, data: Prisma.CouponCreateInput) {
  return database.coupon.create({ data, select: couponTermsSelect });
}

export function updateCouponRow(
  database: DatabaseClient,
  couponId: string,
  data: Prisma.CouponUpdateInput,
) {
  return database.coupon.update({ where: { id: couponId }, data, select: couponTermsSelect });
}

export async function lockCoupon(
  database: DatabaseClient,
  couponId: string,
): Promise<CouponRow | null> {
  await database.$queryRaw`SELECT id FROM coupons WHERE id = ${couponId}::uuid FOR UPDATE`;
  return findCouponById(database, couponId);
}

// L63: a cancelled order gives its coupon use back: its redemption row goes and the guarded decrement
// never takes used_count below 0. Returns the coupon id when there was a redemption.
export async function releaseCouponRedemption(
  database: DatabaseClient,
  orderId: string,
): Promise<string | null> {
  const [released] = await database.$queryRaw<{ coupon_id: string }[]>`
    DELETE FROM coupon_redemptions WHERE order_id = ${orderId}::uuid RETURNING coupon_id::text`;
  if (released === undefined) return null;
  await database.$executeRaw`
    UPDATE coupons SET used_count = used_count - 1, updated_at = now()
    WHERE id = ${released.coupon_id}::uuid AND used_count > 0`;
  return released.coupon_id;
}
