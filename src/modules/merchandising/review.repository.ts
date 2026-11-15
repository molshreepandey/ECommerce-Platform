import type { DatabaseClient } from '@/lib/db';

// A line the customer may review: their own order line inside a DELIVERED shipment (C21: verified
// buyers, delivered items only).
export function findDeliveredOrderItem(
  database: DatabaseClient,
  customerId: string,
  orderItemId: string,
) {
  return database.orderItem.findFirst({
    where: {
      id: orderItemId,
      order: { customerId },
      shipmentItems: { some: { shipment: { status: 'DELIVERED' } } },
    },
    select: { id: true, productId: true },
  });
}

export function insertReview(
  database: DatabaseClient,
  review: {
    productId: string;
    customerId: string;
    orderItemId: string;
    rating: number;
    title: string;
    body: string;
  },
) {
  return database.review.create({
    data: review,
    select: { id: true, rating: true, title: true, body: true, createdAt: true },
  });
}

export function listReviewsForProduct(database: DatabaseClient, productId: string, limit: number) {
  return database.review.findMany({
    where: { productId },
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      createdAt: true,
      customer: { select: { fullName: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
}

export async function reviewSummary(database: DatabaseClient, productId: string) {
  const result = await database.review.aggregate({
    where: { productId },
    _avg: { rating: true },
    _count: { _all: true },
  });
  return { averageRating: result._avg.rating, reviewCount: result._count._all };
}

export function listReviewStatusForOrder(
  database: DatabaseClient,
  customerId: string,
  orderId: string,
) {
  return database.orderItem.findMany({
    where: { orderId, order: { customerId } },
    select: {
      id: true,
      review: { select: { id: true, rating: true } },
      shipmentItems: { select: { shipment: { select: { status: true } } } },
    },
  });
}
