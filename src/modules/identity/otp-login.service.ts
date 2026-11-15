import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { enforceRateLimit } from '@/lib/rate-limit/rate-limit';
import { recordAuditEvent } from '@/modules/audit/audit.service';

import type { RequestMetadata } from './access-control';
import { indianMobileSchema } from './identity.schema';
import {
  consumeChallenge,
  countWrongAttempt,
  findActiveCustomerByPhone,
  findLatestOtpChallenge,
  insertOtpChallenge,
  lockPhoneForOtp,
} from './otp.repository';
import { isOtpDisplayedInUi, logOtpSender, type OtpSender } from './otp-sender';
import { type StartedSession, startSession } from './session.service';

export const otpValidityMinutes = 5;
export const otpResendCooldownSeconds = 30;
export const maximumOtpAttempts = 5;

export const requestOtpSchema = z.strictObject({ phone: indianMobileSchema });
export const verifyOtpSchema = z.strictObject({
  phone: indianMobileSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

function hashCode(challengeId: string, code: string): string {
  return createHash('sha256').update(`${challengeId}:${code}`).digest('hex');
}

const otpErrors = {
  cooldown: (retryAfterSeconds: number) =>
    new DomainError({
      kind: 'RATE_LIMITED',
      code: 'OTP_RESEND_COOLDOWN',
      message: `Wait ${String(retryAfterSeconds)} seconds before asking for a new code.`,
      details: { retryAfterSeconds },
    }),
  invalid: () =>
    new DomainError({
      kind: 'UNAUTHENTICATED',
      code: 'OTP_INVALID',
      message: 'The code is not correct.',
    }),
  expired: () =>
    new DomainError({
      kind: 'UNAUTHENTICATED',
      code: 'OTP_EXPIRED',
      message: 'The code has expired. Ask for a new one.',
    }),
  locked: () =>
    new DomainError({
      kind: 'UNAUTHENTICATED',
      code: 'OTP_LOCKED',
      message: 'Too many wrong codes. Ask for a new one.',
    }),
};

export interface OtpRequestResult {
  expiresAt: string;
  resendAvailableAt: string;
  displayedOtpCode?: string;
}

// C3: a 6-digit code (crypto.randomInt) stored only as a hash, valid 5 minutes, resend after 30 s,
// rate-limited per IP + phone. An unknown or blocked number gets the same answer and the same cooldown
// (no code is sent), so neither reveals which numbers have accounts.
export async function requestLoginOtp(
  input: z.infer<typeof requestOtpSchema>,
  metadata: RequestMetadata,
  sender: OtpSender = logOtpSender,
): Promise<OtpRequestResult> {
  await enforceRateLimit({
    action: 'otp-request',
    identifier: `${metadata.clientIp ?? 'unknown'}|${input.phone}`,
  });
  const now = new Date();
  const issued = await getDatabase().$transaction(async (transaction) => {
    await lockPhoneForOtp(transaction, input.phone);
    const latest = await findLatestOtpChallenge(transaction, input.phone);
    const cooldownEndsAt =
      latest === null ? 0 : latest.lastSentAt.getTime() + otpResendCooldownSeconds * 1000;
    if (cooldownEndsAt > now.getTime()) {
      throw otpErrors.cooldown(Math.ceil((cooldownEndsAt - now.getTime()) / 1000));
    }
    const customer = await findActiveCustomerByPhone(transaction, input.phone);
    const challengeId = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    // An unknown or blocked number also gets a challenge (its code is never sent, and verify refuses it
    // because no active customer has the number), so the resend cooldown cannot reveal which numbers
    // have accounts.
    await insertOtpChallenge(transaction, {
      id: challengeId,
      phone: input.phone,
      codeHash: hashCode(challengeId, code),
      expiresAt: new Date(now.getTime() + otpValidityMinutes * 60_000),
      lastSentAt: now,
    });
    return customer === null ? null : { challengeId, code };
  });
  if (issued !== null) await sender.send({ phone: input.phone, ...issued });
  return {
    expiresAt: new Date(now.getTime() + otpValidityMinutes * 60_000).toISOString(),
    resendAvailableAt: new Date(now.getTime() + otpResendCooldownSeconds * 1000).toISOString(),
    ...(issued !== null && isOtpDisplayedInUi() ? { displayedOtpCode: issued.code } : {}),
  };
}

// Constant-time compare on the latest challenge; 5 wrong codes lock it; a correct code is consumed once
// and starts the normal customer session.
export async function verifyLoginOtp(
  input: z.infer<typeof verifyOtpSchema>,
  metadata: RequestMetadata,
): Promise<{ customerId: string; session: StartedSession }> {
  await enforceRateLimit({
    action: 'otp-verify',
    identifier: `${metadata.clientIp ?? 'unknown'}|${input.phone}`,
  });
  const database = getDatabase();
  const challenge = await findLatestOtpChallenge(database, input.phone);
  if (challenge === null || challenge.consumedAt !== null) throw otpErrors.invalid();
  if (challenge.attemptCount >= maximumOtpAttempts) throw otpErrors.locked();
  if (challenge.expiresAt.getTime() <= Date.now()) throw otpErrors.expired();
  const matches = timingSafeEqual(
    Buffer.from(hashCode(challenge.id, input.code), 'hex'),
    Buffer.from(challenge.codeHash, 'hex'),
  );
  if (!matches) {
    const attempts = await countWrongAttempt(database, challenge.id, maximumOtpAttempts);
    throw attempts === null || attempts >= maximumOtpAttempts
      ? otpErrors.locked()
      : otpErrors.invalid();
  }
  return database.$transaction(async (transaction) => {
    if (!(await consumeChallenge(transaction, challenge.id, maximumOtpAttempts)))
      throw otpErrors.invalid();
    const customer = await findActiveCustomerByPhone(transaction, input.phone);
    if (customer === null) throw otpErrors.invalid();
    await recordAuditEvent(transaction, {
      actorType: 'CUSTOMER',
      actorId: customer.id,
      action: 'customer.otp_login',
      entityType: 'customer',
      entityId: customer.id,
      ipAddress: metadata.clientIp,
      requestId: metadata.requestId,
    });
    const session = await startSession(transaction, {
      subjectType: 'CUSTOMER',
      subjectId: customer.id,
    });
    return { customerId: customer.id, session };
  });
}
