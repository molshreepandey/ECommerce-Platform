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
  'catalogue.product_type_created',
  'catalogue.product_type_updated',
  'catalogue.product_type_archived',
  'catalogue.product_type_restored',
  'catalogue.attribute_definition_created',
  'catalogue.attribute_definition_updated',
  'catalogue.attribute_definition_archived',
  'catalogue.brand_created',
  'catalogue.brand_updated',
  'catalogue.product_created',
  'catalogue.product_updated',
  'catalogue.product_status_changed',
  'catalogue.variant_created',
  'catalogue.variants_generated',
  'catalogue.variant_updated',
  'catalogue.variant_status_changed',
  'catalogue.media_added',
  'catalogue.media_updated',
  'catalogue.media_reordered',
  'catalogue.media_deleted',
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
