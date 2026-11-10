import type { ActorType } from '@/generated/prisma/enums';

export const auditActions = [
  'customer.registered',
  'customer.profile_updated',
  'customer.address_created',
  'customer.address_updated',
  'customer.address_archived',
  'customer.default_address_changed',
  'customer.logout_everywhere',
  'staff.login_succeeded',
  'staff.login_failed',
] as const;

export type AuditAction = (typeof auditActions)[number];

export type AuditData = Readonly<Record<string, string | number | boolean | null>>;

export interface AuditEvent {
  actorType: ActorType;
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: AuditData;
  after?: AuditData;
  ipAddress: string | null;
  requestId: string | null;
}
