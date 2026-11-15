import { getDatabase, isUniqueViolation } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import type { CustomerContext } from '@/modules/identity/access-control';
import { enqueueProductReindex } from '@/modules/search/search-outbox.repository';

import type { CreateReviewInput } from './review.schema';
import {
  findDeliveredOrderItem,
  insertReview,
  listReviewStatusForOrder,
  listReviewsForProduct,
  reviewSummary,
} from './review.repository';

const reviewPageSize = 20;

// C21: verified buyers only; one review per order line (unique order_item_id). The product's rating in
// the search index is refreshed through the outbox in the same transaction.
export async function createReview(customer: CustomerContext, input: CreateReviewInput) {
  // L5: one budget per customer (policy `review-write`), checked before any database work.
  await enforceRateLimit({ action: 'review-write', identifier: customer.customerId });
  try {
    return await getDatabase().$transaction(async (transaction) => {
      const item = await findDeliveredOrderItem(
        transaction,
        customer.customerId,
        input.orderItemId,
      );
      if (item === null) {
        throw new DomainError({
          kind: 'FORBIDDEN',
          code: 'REVIEW_NOT_ALLOWED',
          message: 'You can review an item only after it has been delivered to you.',
        });
      }
      const review = await insertReview(transaction, {
        productId: item.productId,
        customerId: customer.customerId,
        orderItemId: item.id,
        rating: input.rating,
        title: input.title,
        body: input.body,
      });
      await enqueueProductReindex(transaction, item.productId);
      return review;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError({
        kind: 'CONFLICT',
        code: 'REVIEW_EXISTS',
        message: 'You have already reviewed this item.',
      });
    }
    throw error;
  }
}

export async function getProductReviews(productId: string) {
  const database = getDatabase();
  const [summary, reviews] = await Promise.all([
    reviewSummary(database, productId),
    listReviewsForProduct(database, productId, reviewPageSize),
  ]);
  return {
    averageRating:
      summary.averageRating === null ? null : Math.round(summary.averageRating * 10) / 10,
    reviewCount: summary.reviewCount,
    reviews: reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      title: review.title,
      body: review.body,
      createdAt: review.createdAt,
      // Only the first name is shown publicly.
      authorName: review.customer.fullName.split(' ')[0] ?? 'Customer',
    })),
  };
}

// The order page: which delivered lines can still be reviewed, and the rating of those already reviewed.
export async function getOrderReviewStatus(
  customer: CustomerContext,
  orderId: string,
): Promise<Record<string, { canReview: boolean; rating: number | null }>> {
  const items = await listReviewStatusForOrder(getDatabase(), customer.customerId, orderId);
  return Object.fromEntries(
    items.map((item) => {
      const delivered = item.shipmentItems.some(({ shipment }) => shipment.status === 'DELIVERED');
      return [
        item.id,
        { canReview: delivered && item.review === null, rating: item.review?.rating ?? null },
      ];
    }),
  );
}
