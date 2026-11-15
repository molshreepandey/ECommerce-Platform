import { apiHandler } from '@/lib/api-handler';
import { requirePermission } from '@/modules/identity/access-control';
import { getCustomerDetail } from '@/modules/identity/customer-admin.service';

import { customerIdFrom } from '../customer-id';

export const GET = apiHandler(
  async (request, routeContext: { params: Promise<{ customerId: string }> }) => {
    const staff = await requirePermission(request, 'customers.read');
    return Response.json(await getCustomerDetail(staff, await customerIdFrom(routeContext)));
  },
);
