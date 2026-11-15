import { z } from 'zod';

export const createReviewSchema = z.strictObject({
  orderItemId: z.uuid().transform((value) => value.toLowerCase()),
  rating: z.int().min(1).max(5),
  title: z.string().trim().max(100).default(''),
  body: z.string().trim().max(2000).default(''),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
