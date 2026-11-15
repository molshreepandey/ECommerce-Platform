import { z } from 'zod';

import { getDatabase } from '@/lib/db';
import { assertStaffPermission, type StaffContext } from '@/modules/identity/access-control';

import { listAuditRows } from './audit.repository';

const optionalTrimmed = z
  .string()
  .trim()
  .max(100)
  .transform((value) => (value === '' ? undefined : value))
  .optional()
  .catch(undefined);

export const auditListSchema = z.object({
  entityType: optionalTrimmed
    .pipe(
      z
        .string()
        .regex(/^[a-z_]{1,40}$/)
        .optional(),
    )
    .catch(undefined),
  entityId: optionalTrimmed,
  actorId: z.uuid().optional().catch(undefined),
  action: optionalTrimmed
    .pipe(
      z
        .string()
        .regex(/^[a-z_.]{1,60}$/)
        .optional(),
    )
    .catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  before: z.uuid().optional().catch(undefined),
});

const pageSize = 50;

function istDayStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+05:30`);
}

// D46: actor, action, entity, before → after, IP and time, newest first, filterable.
export async function listAuditEntries(
  staff: StaffContext,
  query: z.infer<typeof auditListSchema>,
) {
  assertStaffPermission(staff, 'audit.read');
  const rows = await listAuditRows(getDatabase(), {
    entityType: query.entityType ?? null,
    entityId: query.entityId ?? null,
    actorId: query.actorId?.toLowerCase() ?? null,
    actionPrefix: query.action ?? null,
    createdFrom: query.from === undefined ? null : istDayStart(query.from),
    createdTo:
      query.to === undefined ? null : new Date(istDayStart(query.to).getTime() + 86_400_000),
    beforeId: query.before?.toLowerCase() ?? null,
    limit: pageSize,
  });
  const items = rows.slice(0, pageSize);
  return { items, nextBefore: rows.length > pageSize ? (items.at(-1)?.id ?? null) : null };
}
