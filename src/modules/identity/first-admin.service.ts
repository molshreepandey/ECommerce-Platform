import type { z } from 'zod';

import type { PrismaClient } from '@/generated/prisma/client';
import { isUniqueViolation } from '@/lib/db';
import { recordAuditEvent } from '@/modules/audit/audit.service';

import { demoCredentialField } from './demo-credentials';
import { hashPassword } from './password-hasher';
import { ensureRbacCatalogue } from './rbac-catalogue';
import { insertStaffUser, lockStaffManagement, superAdminRoleCode } from './staff-admin.repository';
import { createStaffSchema } from './staff-admin.schema';

// First super admin of a fresh deployment (staging/production refuse the demo seed, so nothing else can
// create one). One-time: refused as soon as any staff account exists; from then on staff are managed on
// the admin Staff page. Credentials come from the environment; the password is never logged or audited.

export const firstAdminEnvironmentNames = {
  fullName: 'FIRST_ADMIN_NAME',
  email: 'FIRST_ADMIN_EMAIL',
  password: 'FIRST_ADMIN_PASSWORD',
} as const;

const firstAdminInputSchema = createStaffSchema.pick({
  fullName: true,
  email: true,
  password: true,
});
export type FirstAdminInput = z.infer<typeof firstAdminInputSchema>;

export class FirstAdminRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirstAdminRefusedError';
  }
}

// Messages name the variable and the rule, never the value (the password must not reach a log).
export function parseFirstAdminEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): FirstAdminInput {
  const parsed = firstAdminInputSchema.safeParse({
    fullName: environment[firstAdminEnvironmentNames.fullName],
    email: environment[firstAdminEnvironmentNames.email],
    password: environment[firstAdminEnvironmentNames.password],
  });
  if (!parsed.success) {
    const environmentNameByField = new Map<PropertyKey, string>(
      Object.entries(firstAdminEnvironmentNames),
    );
    const problems = parsed.error.issues.map(
      (issue) =>
        `${environmentNameByField.get(issue.path[0] ?? '') ?? 'first-admin setting'}: ${issue.message}`,
    );
    throw new FirstAdminRefusedError(`Invalid first-admin settings:\n  ${problems.join('\n  ')}`);
  }
  // Publicly known demo credentials are refused in every environment for this account.
  const demoField = demoCredentialField(parsed.data);
  if (demoField === 'email') {
    throw new FirstAdminRefusedError(
      `${firstAdminEnvironmentNames.email}: the demo email domain is reserved; use a real address`,
    );
  }
  if (demoField === 'password') {
    throw new FirstAdminRefusedError(
      `${firstAdminEnvironmentNames.password}: this password is publicly known; choose another`,
    );
  }
  return parsed.data;
}

export async function createFirstSuperAdmin(
  database: PrismaClient,
  input: FirstAdminInput,
): Promise<{ staffUserId: string; email: string }> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await database.$transaction(
      async (transaction) => {
        // The staff-management lock serialises two bootstraps (and any staff change) in flight at once.
        await lockStaffManagement(transaction);
        const existingStaff = await transaction.staffUser.count();
        if (existingStaff > 0) {
          throw new FirstAdminRefusedError(
            `Refusing: ${String(existingStaff)} staff account(s) already exist. The first admin is created ` +
              'only once; add further staff on the admin Staff page.',
          );
        }
        const roleIdByCode = await ensureRbacCatalogue(transaction);
        const superAdminRoleId = roleIdByCode.get(superAdminRoleCode);
        if (superAdminRoleId === undefined) {
          throw new Error(`RBAC catalogue has no ${superAdminRoleCode} role`);
        }
        const created = await insertStaffUser(transaction, {
          fullName: input.fullName,
          email: input.email,
          passwordHash,
          roleIds: [superAdminRoleId],
        });
        await recordAuditEvent(transaction, {
          actorType: 'SYSTEM',
          actorId: null,
          action: 'staff.bootstrapped',
          entityType: 'staff_user',
          entityId: created.id,
          after: { email: input.email, fullName: input.fullName, roleCodes: superAdminRoleCode },
          ipAddress: null,
          requestId: null,
        });
        return { staffUserId: created.id, email: input.email };
      },
      // Run once from a workstation against a hosted database: the catalogue upserts are dozens of round
      // trips over the public proxy, well past Prisma's 5 s default, so allow up to two minutes.
      { maxWait: 30_000, timeout: 120_000 },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new FirstAdminRefusedError('Refusing: a staff account with this email already exists.');
    }
    throw error;
  }
}
