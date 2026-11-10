import type { SessionSubjectType } from '@/generated/prisma/enums';
import { getConfig } from '@/lib/config';
import { type DatabaseClient, getDatabase } from '@/lib/db';

import {
  type ActiveSessionRow,
  findActiveSessionByTokenHash,
  insertSession,
  revokeSessionByTokenHash,
} from './session.repository';
import { generateSessionToken, hashSessionToken } from './session-token';

const millisecondsPerHour = 3_600_000;

export interface StartedSession {
  sessionToken: string;
  sessionId: string;
  expiresAt: Date;
}

function sessionLifetimeMilliseconds(subjectType: SessionSubjectType): number {
  const { customerSessionTtlDays, staffSessionTtlHours } = getConfig().authentication;
  return subjectType === 'CUSTOMER'
    ? customerSessionTtlDays * 24 * millisecondsPerHour
    : staffSessionTtlHours * millisecondsPerHour;
}

export async function startSession(
  database: DatabaseClient,
  subject: { subjectType: SessionSubjectType; subjectId: string },
): Promise<StartedSession> {
  const sessionToken = generateSessionToken();
  const session = await insertSession(database, {
    tokenHash: hashSessionToken(sessionToken),
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    expiresAt: new Date(Date.now() + sessionLifetimeMilliseconds(subject.subjectType)),
  });
  return { sessionToken, sessionId: session.id, expiresAt: session.expiresAt };
}

export function findActiveSession(sessionToken: string): Promise<ActiveSessionRow | null> {
  return findActiveSessionByTokenHash(getDatabase(), hashSessionToken(sessionToken));
}

export async function endSession(sessionToken: string): Promise<void> {
  await revokeSessionByTokenHash(getDatabase(), hashSessionToken(sessionToken));
}
