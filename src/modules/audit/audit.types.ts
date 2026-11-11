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
  'taxonomy.category_created',
  'taxonomy.category_updated',
  'taxonomy.category_moved',
  'taxonomy.category_status_changed',
  'taxonomy.category_deleted',
  'taxonomy.product_tagged',
  'grouping.group_created',
  'grouping.group_renamed',
  'grouping.group_deleted',
  'grouping.members_added',
  'grouping.member_removed',
  'grouping.members_reordered',
  'inventory.stock_added',
  'inventory.stock_removed',
  'inventory.stock_set',
  'inventory.stock_received',
  'inventory.stock_reserved',
  'inventory.reservation_released',
  'inventory.low_stock_threshold_changed',
  'warehouse.created',
  'warehouse.updated',
  'warehouse.status_changed',
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
