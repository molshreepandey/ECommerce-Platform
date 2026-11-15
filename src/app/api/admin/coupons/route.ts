import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requestMetadata, requirePermission } from '@/modules/identity/access-control';
import { couponInputSchema } from '@/modules/pricing/coupon.schema';
import { createCoupon, listCoupons } from '@/modules/pricing/coupon.service';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'coupons.write');
  return Response.json({ coupons: await listCoupons(staff) });
});

export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const staff = await requirePermission(request, 'coupons.write');
  const input = await parseJsonBody(request, couponInputSchema);
  const coupon = await createCoupon(staff, input, requestMetadata(request, requestContext));
  return Response.json({ coupon }, { status: 201 });
});
