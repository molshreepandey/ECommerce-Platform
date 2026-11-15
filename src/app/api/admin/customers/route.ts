import { apiHandler } from '@/lib/api-handler';
import { requirePermission } from '@/modules/identity/access-control';
import { customerListSchema, listCustomers } from '@/modules/identity/customer-admin.service';

export const GET = apiHandler(async (request) => {
  const staff = await requirePermission(request, 'customers.read');
  const query = customerListSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  return Response.json(await listCustomers(staff, query));
});
