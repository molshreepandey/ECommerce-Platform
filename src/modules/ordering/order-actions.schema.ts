import { z } from 'zod';

export const cancelOrderSchema = z.strictObject({
  reason: z.string().trim().min(3, 'Tell us why the order is cancelled.').max(300),
});

export const shipmentActionBodySchema = z
  .strictObject({
    reason: z.string().trim().max(300).optional(),
    outcome: z.enum(['DELIVERED', 'DELIVERY_FAILED']).optional(),
    warehouseId: z
      .uuid()
      .transform((value) => value.toLowerCase())
      .optional(),
  })
  .default({});
