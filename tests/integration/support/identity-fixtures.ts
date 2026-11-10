import { getDatabase } from '@/lib/db';
import type { RequestMetadata } from '@/modules/identity/access-control';

import { applyDemoPasswordHashes } from '../../../prisma/seed/demo-passwords.seed';
import { seedIdentity } from '../../../prisma/seed/identity.seed';

export { demoPassword } from '../../../prisma/seed/demo-credentials';

let requestCounter = 0;

// Each call gets its own documentation-range IP so rate-limit buckets don't collide between tests.
export function testMetadata(clientIp: string | null = null): RequestMetadata {
  requestCounter += 1;
  return {
    requestId: `integration-request-${requestCounter}`,
    clientIp: clientIp ?? `198.51.100.${(requestCounter % 250) + 1}`,
  };
}

export async function seedDemoIdentity(): Promise<void> {
  const database = getDatabase();
  await seedIdentity(database);
  await applyDemoPasswordHashes(database);
}

const secretLooking = /pass(word)?|hash|token|secret|otp|cookie|session|credential|argon2/i;

// Every audit row, serialised, must not contain secret-looking keys or any of the given raw values.
export async function expectAuditTrailFreeOf(rawSecrets: string[]): Promise<number> {
  const rows = await getDatabase().auditLog.findMany({ select: { before: true, after: true } });
  for (const row of rows) {
    for (const data of [row.before, row.after]) {
      if (data === null || typeof data !== 'object' || Array.isArray(data)) continue;
      for (const key of Object.keys(data)) {
        if (secretLooking.test(key)) throw new Error(`audit data contains the key ${key}`);
      }
      const serialised = JSON.stringify(data);
      if (serialised.includes('$argon2')) throw new Error('audit data contains a password hash');
      for (const secret of rawSecrets) {
        if (serialised.includes(secret)) throw new Error('audit data contains a raw secret');
      }
    }
  }
  return rows.length;
}
