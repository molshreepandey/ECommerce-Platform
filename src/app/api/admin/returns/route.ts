import { apiHandler } from '@/lib/api-handler';
import { requirePermission } from '@/modules/identity/access-control';
import { listReturns } from '@/modules/returns/return-admin.service';
import { returnListSchema } from '@/modules/returns/returns.schema';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'orders.read');
  const { status } = returnListSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  return Response.json({ returns: await listReturns(staff, status ?? null) });
});
