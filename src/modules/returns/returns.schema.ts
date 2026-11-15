import { z } from 'zod';

const uuid = z.uuid().transform((value) => value.toLowerCase());

export const createReturnSchema = z
  .strictObject({
    requestType: z.enum(['RETURN', 'EXCHANGE']),
    reason: z.string().trim().min(5, 'Tell us what is wrong (at least 5 characters).').max(300),
    items: z
      .array(
        z.strictObject({
          orderItemId: uuid,
          quantity: z.int().min(1).max(10),
          exchangeVariantId: uuid.optional(),
        }),
      )
      .min(1, 'Choose at least one item.')
      .max(20)
      .refine(
        (items) => new Set(items.map(({ orderItemId }) => orderItemId)).size === items.length,
        'Each item once.',
      ),
  })
  .refine(
    (input) =>
      input.requestType === 'RETURN' ||
      input.items.every(({ exchangeVariantId }) => exchangeVariantId !== undefined),
    { message: 'Choose the replacement for every item in an exchange.', path: ['items'] },
  );

export const decideReturnSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('APPROVE'),
    receivingWarehouseId: uuid,
    note: z.string().trim().max(300).optional(),
  }),
  z.strictObject({
    decision: z.literal('REJECT'),
    note: z.string().trim().min(3, 'Give the reason.').max(300),
  }),
]);

export const refundSchema = z.strictObject({
  refundMethod: z.enum(['BANK_TRANSFER', 'UPI']),
  reference: z.string().trim().min(3).max(100),
  amountPaise: z.int().min(1).max(1_000_000_000),
});

export const returnListSchema = z.object({
  status: z
    .enum([
      'REQUESTED',
      'APPROVED',
      'REJECTED',
      'PICKED_UP',
      'RECEIVED',
      'RESTOCKED',
      'REFUNDED',
      'EXCHANGED',
    ])
    .optional()
    .catch(undefined),
});

export type CreateReturnInput = z.infer<typeof createReturnSchema>;
export type DecideReturnInput = z.infer<typeof decideReturnSchema>;
export type RefundInput = z.infer<typeof refundSchema>;
