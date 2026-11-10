import { createHash, randomBytes } from 'node:crypto';

const sessionTokenBytes = 32;

export function generateSessionToken(): string {
  return randomBytes(sessionTokenBytes).toString('base64url');
}

export function hashSessionToken(sessionToken: string): string {
  return createHash('sha256').update(sessionToken).digest('hex');
}
