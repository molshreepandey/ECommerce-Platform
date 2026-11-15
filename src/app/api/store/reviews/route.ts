import { apiHandler } from '@/lib/api-handler';
import { parseJsonBody } from '@/lib/request-body';
import { requireCustomer } from '@/modules/identity/access-control';
import { createReviewSchema } from '@/modules/merchandising/review.schema';
import { createReview } from '@/modules/merchandising/review.service';

// C21: 201; 403 REVIEW_NOT_ALLOWED unless the customer's item was delivered; 409 REVIEW_EXISTS.
export const POST = apiHandler(async (request) => {
  const customer = await requireCustomer(request);
  const input = await parseJsonBody(request, createReviewSchema);
  return Response.json({ review: await createReview(customer, input) }, { status: 201 });
});
