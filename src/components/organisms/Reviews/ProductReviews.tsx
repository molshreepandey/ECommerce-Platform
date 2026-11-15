import { Card } from '@/components/atoms/Card';
import { Heading } from '@/components/atoms/Heading';
import { Text } from '@/components/atoms/Text';
import { formatDate } from '@/lib/date-format';

export type ProductReviewList = Readonly<{
  averageRating: number | null;
  reviewCount: number;
  reviews: readonly {
    id: string;
    rating: number;
    title: string;
    body: string;
    createdAt: Date | string;
    authorName: string;
  }[];
}>;

export function stars(rating: number): string {
  const whole = Math.round(rating);
  return `${'★'.repeat(whole)}${'☆'.repeat(5 - whole)}`;
}

// C21: verified-buyer reviews (every review comes from a delivered order line).
export function ProductReviews({ list }: Readonly<{ list: ProductReviewList }>) {
  return (
    <Card as="section" aria-labelledby="product-reviews">
      <div className="flex flex-col gap-md">
        <div className="flex flex-wrap items-baseline justify-between gap-sm">
          <Heading level={2} variant="heading4" id="product-reviews">
            Ratings and reviews
          </Heading>
          {list.averageRating === null ? null : (
            <Text
              variant="body2-medium"
              aria-label={`Rated ${String(list.averageRating)} out of 5`}
            >
              {stars(list.averageRating)} {list.averageRating.toFixed(1)} · {list.reviewCount}{' '}
              {list.reviewCount === 1 ? 'review' : 'reviews'}
            </Text>
          )}
        </div>
        {list.reviews.length === 0 ? (
          <Text tone="muted">
            No reviews yet. Customers can review an item once it is delivered.
          </Text>
        ) : (
          <ul className="flex flex-col gap-md">
            {list.reviews.map((review) => (
              <li
                key={review.id}
                className="flex flex-col gap-xs border-b border-strokes pb-md last:border-b-0"
              >
                <Text variant="body2-medium" aria-label={`${String(review.rating)} out of 5`}>
                  {stars(review.rating)} {review.title}
                </Text>
                {review.body === '' ? null : <Text variant="body2">{review.body}</Text>}
                <Text variant="body3" tone="muted">
                  {review.authorName} · verified buyer · {formatDate(review.createdAt)}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
