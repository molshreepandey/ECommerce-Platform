import { apiHandler } from '@/lib/api-handler';
import { requireCustomer } from '@/modules/identity/access-control';
import {
  customerOrderListSchema,
  listCustomerOrders,
} from '@/modules/ordering/order-query.service';

export const GET = apiHandler(async (request) => {
  const customer = await requireCustomer(request);
  const query = customerOrderListSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  return Response.json(await listCustomerOrders(customer, query));
});
