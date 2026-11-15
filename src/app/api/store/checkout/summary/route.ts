import { apiHandler } from '@/lib/api-handler';
import { requireCustomer } from '@/modules/identity/access-control';
import { checkoutSummaryQuerySchema } from '@/modules/ordering/checkout.schema';
import { quoteCheckout } from '@/modules/ordering/checkout.service';

export const GET = apiHandler(async (request) => {
  const customer = await requireCustomer(request);
  const query = checkoutSummaryQuerySchema.parse({
    addressId: request.nextUrl.searchParams.get('addressId') ?? undefined,
    paymentMethod: request.nextUrl.searchParams.get('paymentMethod') ?? undefined,
  });
  return Response.json({ summary: await quoteCheckout(customer, query) });
});
