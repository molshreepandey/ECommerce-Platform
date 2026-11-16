import type { DatabaseClient } from '@/lib/db';

export function findLatestOtpChallenge(database: DatabaseClient, phone: string) {
  return database.otpChallenge.findFirst({
    where: { phone },
    select: {
      id: true,
      codeHash: true,
      attemptCount: true,
      expiresAt: true,
      lastSentAt: true,
      consumedAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

export function insertOtpChallenge(
  database: DatabaseClient,
  challenge: { id: string; phone: string; codeHash: string; expiresAt: Date; lastSentAt: Date },
) {
  return database.otpChallenge.create({ data: challenge, select: { id: true } });
}

// Guarded: a locked, used or expired challenge never counts another attempt.
// Claims one of the challenge's attempts before the code is compared, so parallel guesses cannot all be
// evaluated against a count read earlier: null once all are used (or the challenge was consumed).
export async function claimOtpAttempt(
  database: DatabaseClient,
  challengeId: string,
  maximum: number,
): Promise<number | null> {
  const rows = await database.$queryRaw<{ attempt_count: number }[]>`
    UPDATE otp_challenges SET attempt_count = attempt_count + 1
    WHERE id = ${challengeId}::uuid AND consumed_at IS NULL AND attempt_count < ${maximum}
    RETURNING attempt_count`;
  return rows[0]?.attempt_count ?? null;
}

// Single use: only one request can consume a challenge. Its attempt is already claimed (counted), so the
// last allowed attempt has attempt_count = maximum.
export async function consumeChallenge(
  database: DatabaseClient,
  challengeId: string,
  maximum: number,
): Promise<boolean> {
  const updated = await database.$executeRaw`
    UPDATE otp_challenges SET consumed_at = now()
    WHERE id = ${challengeId}::uuid AND consumed_at IS NULL AND attempt_count <= ${maximum} AND expires_at > now()`;
  return updated === 1;
}

export async function lockPhoneForOtp(database: DatabaseClient, phone: string): Promise<void> {
  await database.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`otp:${phone}`}))) AS locked`;
}

export function findActiveCustomerByPhone(database: DatabaseClient, phone: string) {
  return database.customer.findFirst({ where: { phone, status: 'ACTIVE' }, select: { id: true } });
}
