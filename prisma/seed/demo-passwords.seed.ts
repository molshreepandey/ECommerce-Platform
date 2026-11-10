import { hashPassword, verifyPassword } from '../../src/modules/identity/password-hasher';

import { assertDemoCredentialsAllowed, demoPassword } from './demo-credentials';
import { demoCustomers, staffUsers } from './identity.seed';
import type { SeedClient } from './seed-client';

export interface DemoPasswordResult {
  updated: string[];
  alreadyCurrent: string[];
  missing: string[];
}

async function needsNewHash(currentHash: string | undefined): Promise<boolean> {
  return currentHash === undefined || !(await verifyPassword(currentHash, demoPassword));
}

// Raw UPDATEs change only password_hash; Prisma's update() would also bump updated_at.
export async function applyDemoPasswordHashes(client: SeedClient): Promise<DemoPasswordResult> {
  assertDemoCredentialsAllowed(process.env['APP_ENV']);
  const result: DemoPasswordResult = { updated: [], alreadyCurrent: [], missing: [] };

  for (const { email } of staffUsers) {
    const account = await client.staffUser.findUnique({
      where: { email },
      select: { passwordHash: true },
    });
    if (account === null) {
      result.missing.push(email);
    } else if (await needsNewHash(account.passwordHash)) {
      const passwordHash = await hashPassword(demoPassword);
      await client.$executeRaw`UPDATE staff_users SET password_hash = ${passwordHash} WHERE email = ${email}`;
      result.updated.push(email);
    } else {
      result.alreadyCurrent.push(email);
    }
  }

  for (const { email } of demoCustomers) {
    const account = await client.customer.findUnique({
      where: { email },
      select: { passwordHash: true },
    });
    if (account === null) {
      result.missing.push(email);
    } else if (await needsNewHash(account.passwordHash)) {
      const passwordHash = await hashPassword(demoPassword);
      await client.$executeRaw`UPDATE customers SET password_hash = ${passwordHash} WHERE email = ${email}`;
      result.updated.push(email);
    } else {
      result.alreadyCurrent.push(email);
    }
  }
  return result;
}
