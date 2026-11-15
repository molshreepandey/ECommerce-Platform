import { type DatabaseClient, getDatabase, isUniqueViolation } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import type { AuditData } from '@/modules/audit/audit.types';
import {
  assertStaffPermission,
  type RequestMetadata,
  type StaffContext,
} from '@/modules/identity/access-control';

import {
  type CouponRow,
  findCouponById,
  incrementCouponUsage,
  insertCoupon,
  insertCouponRedemption,
  listCouponRows,
  lockCoupon,
  updateCouponRow,
} from './coupon.repository';
import type { CouponInput, UpdateCouponInput } from './coupon.schema';

const couponNotFound = () =>
  new DomainError({
    kind: 'NOT_FOUND',
    code: 'COUPON_NOT_FOUND',
    message: 'This coupon was not found.',
  });

function auditFields(coupon: CouponRow | UpdateCouponInput): AuditData {
  return {
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    maxDiscountPaise: coupon.maxDiscountPaise,
    minCartPaise: coupon.minCartPaise,
    validFrom: coupon.validFrom.toISOString(),
    validUntil: coupon.validUntil.toISOString(),
    totalUsageLimit: coupon.totalUsageLimit,
    perCustomerLimit: coupon.perCustomerLimit,
    firstOrderOnly: coupon.firstOrderOnly,
    isActive: coupon.isActive,
  };
}

export function listCoupons(staff: StaffContext): Promise<CouponRow[]> {
  assertStaffPermission(staff, 'coupons.write');
  return listCouponRows(getDatabase());
}

export async function createCoupon(
  staff: StaffContext,
  input: CouponInput,
  metadata: RequestMetadata,
): Promise<CouponRow> {
  assertStaffPermission(staff, 'coupons.write');
  try {
    return await getDatabase().$transaction(async (transaction) => {
      const coupon = await insertCoupon(transaction, input);
      await recordAuditEvent(transaction, {
        actorType: 'STAFF',
        actorId: staff.staffUserId,
        action: 'coupon.created',
        entityType: 'coupon',
        entityId: coupon.id,
        after: { code: coupon.code, ...auditFields(coupon) },
        ipAddress: metadata.clientIp,
        requestId: metadata.requestId,
      });
      return coupon;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError({
        kind: 'CONFLICT',
        code: 'COUPON_CODE_TAKEN',
        message: 'A coupon with this code already exists.',
        details: { fieldErrors: { code: ['A coupon with this code already exists.'] } },
      });
    }
    throw error;
  }
}

// The code never changes (redemptions and orders refer to it). Lowering the usage limit below the
// number already used is refused by the database CHECK and answered with 409.
export async function updateCoupon(
  staff: StaffContext,
  couponId: string,
  input: UpdateCouponInput,
  metadata: RequestMetadata,
): Promise<CouponRow> {
  assertStaffPermission(staff, 'coupons.write');
  return getDatabase().$transaction(async (transaction) => {
    const before = await lockCoupon(transaction, couponId);
    if (before === null) throw couponNotFound();
    if (input.totalUsageLimit !== null && input.totalUsageLimit < before.usedCount) {
      throw new DomainError({
        kind: 'CONFLICT',
        code: 'COUPON_LIMIT_BELOW_USAGE',
        message: `This coupon has already been used ${String(before.usedCount)} times.`,
        details: {
          fieldErrors: { totalUsageLimit: ['Must be at least the number already used.'] },
        },
      });
    }
    const coupon = await updateCouponRow(transaction, couponId, input);
    await recordAuditEvent(transaction, {
      actorType: 'STAFF',
      actorId: staff.staffUserId,
      action: 'coupon.updated',
      entityType: 'coupon',
      entityId: couponId,
      before: auditFields(before),
      after: auditFields(coupon),
      ipAddress: metadata.clientIp,
      requestId: metadata.requestId,
    });
    return coupon;
  });
}

export function findCouponForCheckout(database: DatabaseClient, couponId: string) {
  return findCouponById(database, couponId);
}

// Plan §10A rule 6: guarded increment first; 0 rows means it ran out (409), then the redemption row.
export async function redeemCoupon(
  transaction: DatabaseClient,
  redemption: { couponId: string; customerId: string; orderId: string; discountPaise: number },
): Promise<boolean> {
  if (!(await incrementCouponUsage(transaction, redemption.couponId))) return false;
  await insertCouponRedemption(transaction, redemption);
  return true;
}
