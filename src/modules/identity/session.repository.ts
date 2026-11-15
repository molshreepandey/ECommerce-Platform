import { z } from 'zod';

import type { SessionSubjectType } from '@/generated/prisma/enums';
import type { DatabaseClient } from '@/lib/db';

const activeSessionRowsSchema = z.array(
  z.object({
    session_id: z.string(),
    subject_type: z.enum(['CUSTOMER', 'STAFF']),
    subject_id: z.string(),
    expires_at: z.date(),
    subject_is_active: z.boolean(),
  }),
);

export type ActiveSessionRow = z.infer<typeof activeSessionRowsSchema>[number];

export async function insertSession(
  database: DatabaseClient,
  session: {
    tokenHash: string;
    subjectType: SessionSubjectType;
    subjectId: string;
    expiresAt: Date;
  },
): Promise<{ id: string; expiresAt: Date }> {
  return database.session.create({ data: session, select: { id: true, expiresAt: true } });
}

// One indexed lookup checks the token, revocation, expiry and that the account is still ACTIVE.
export async function findActiveSessionByTokenHash(
  database: DatabaseClient,
  tokenHash: string,
): Promise<ActiveSessionRow | null> {
  const rows = activeSessionRowsSchema.parse(
    await database.$queryRaw`
      SELECT s.id AS session_id, s.subject_type::text AS subject_type, s.subject_id::text AS subject_id,
             s.expires_at,
             COALESCE(c.status = 'ACTIVE', su.status = 'ACTIVE', false) AS subject_is_active
      FROM sessions s
      LEFT JOIN customers c ON s.subject_type = 'CUSTOMER' AND c.id = s.subject_id
      LEFT JOIN staff_users su ON s.subject_type = 'STAFF' AND su.id = s.subject_id
      WHERE s.token_hash = ${tokenHash} AND s.revoked_at IS NULL AND s.expires_at > now()`,
  );
  return rows[0] ?? null;
}

export async function revokeSessionByTokenHash(
  database: DatabaseClient,
  tokenHash: string,
): Promise<number> {
  const { count } = await database.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

export async function revokeAllSessionsForSubject(
  database: DatabaseClient,
  subject: { subjectType: SessionSubjectType; subjectId: string },
): Promise<number> {
  const { count } = await database.session.updateMany({
    where: { ...subject, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

// Every other live session of the subject, keeping the one making the request.
export async function revokeOtherSessionsForSubject(
  database: DatabaseClient,
  subject: { subjectType: SessionSubjectType; subjectId: string },
  keptSessionId: string,
): Promise<number> {
  const { count } = await database.session.updateMany({
    where: { ...subject, revokedAt: null, id: { not: keptSessionId } },
    data: { revokedAt: new Date() },
  });
  return count;
}

export async function findPermissionCodesForStaff(
  database: DatabaseClient,
  staffUserId: string,
): Promise<string[]> {
  const rows = await database.permission.findMany({
    where: { roles: { some: { role: { staffUsers: { some: { staffUserId } } } } } },
    select: { code: true },
  });
  return rows.map(({ code }) => code);
}
