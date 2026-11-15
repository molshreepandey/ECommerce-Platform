import { z } from 'zod';

import { simulatedPaymentScenarios } from './simulated-gateway';

export const maximumDeclinedAttempts = 3;
export const onlinePaymentWindowMinutes = 30;
// Unpaid online orders reserve stock until paid or expired, so one customer may hold only this many.
export const maximumOpenUnpaidOnlineOrders = 2;

export const paymentIdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,100}$/);

export const submitPaymentSchema = z.strictObject({
  scenario: z.enum(simulatedPaymentScenarios),
  amountPaise: z.int().min(1).max(1_000_000_000),
});
export type SubmitPaymentInput = z.infer<typeof submitPaymentSchema>;
