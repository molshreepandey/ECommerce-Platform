import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { DomainError } from '@/lib/errors';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { updateCouponSchema } from '@/modules/pricing/coupon.schema';
import { updateCoupon } from '@/modules/pricing/coupon.service';

export const PUT = apiHandler(
  async (request, { params }: { params: Promise<{ couponId: string }> }, requestContext) => {
    const staff = await requirePermission(request, 'coupons.write');
    const couponId = z.uuid().safeParse((await params).couponId);
    if (!couponId.success) {
      throw new DomainError({
        kind: 'NOT_FOUND',
        code: 'COUPON_NOT_FOUND',
        message: 'This coupon was not found.',
      });
    }
    const input = await parseJsonBody(request, updateCouponSchema);
    const coupon = await updateCoupon(
      staff,
      couponId.data.toLowerCase(),
      input,
      requestMetadata(request, requestContext),
    );
    return Response.json({ coupon });
  },
);
