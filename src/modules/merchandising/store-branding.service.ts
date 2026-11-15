import { cacheTags, expireCacheTagsAfterCommit } from '@/lib/cache-tags';
import { getConfig } from '@/lib/config';
import { type DatabaseClient, getDatabase } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import { allowedImageOrigins, isAllowedImageUrl } from '@/modules/catalogue/image-url';
import {
  assertStaffPermission,
  type RequestMetadata,
  type StaffContext,
} from '@/modules/identity/access-control';
import {
  findStoreSettingValue,
  saveStoreSettingValue,
} from '@/modules/pricing/store-settings.repository';

import {
  defaultStoreBranding,
  type StoreBranding,
  storeBrandingSchema,
} from './store-branding.schema';

const brandingKey = 'store_branding';

export async function loadStoreBranding(
  database: DatabaseClient = getDatabase(),
): Promise<StoreBranding> {
  const parsed = storeBrandingSchema.safeParse(await findStoreSettingValue(database, brandingKey));
  return parsed.success ? parsed.data : defaultStoreBranding;
}

export function getStoreBrandingForStaff(staff: StaffContext): Promise<StoreBranding> {
  assertStaffPermission(staff, 'merchandising.write');
  return loadStoreBranding();
}

// D52: saved like the other settings (row lock, audit before → after); the storefront's cached copy
// expires after commit.
export async function updateStoreBranding(
  staff: StaffContext,
  input: StoreBranding,
  metadata: RequestMetadata,
): Promise<StoreBranding> {
  assertStaffPermission(staff, 'merchandising.write');
  if (
    input.logoUrl !== null &&
    !isAllowedImageUrl(
      input.logoUrl,
      allowedImageOrigins(getConfig().security.contentSecurityPolicy.imageSources),
    )
  ) {
    throw new DomainError({
      kind: 'VALIDATION',
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: { fieldErrors: { logoUrl: ['Use an https image from an allowed image host.'] } },
    });
  }
  await getDatabase().$transaction(async (transaction) => {
    const before = await loadStoreBranding(transaction);
    await saveStoreSettingValue(transaction, brandingKey, input);
    await recordAuditEvent(transaction, {
      actorType: 'STAFF',
      actorId: staff.staffUserId,
      action: 'merchandising.branding_updated',
      entityType: 'store_settings',
      entityId: brandingKey,
      before,
      after: input,
      ipAddress: metadata.clientIp,
      requestId: metadata.requestId,
    });
  });
  await expireCacheTagsAfterCommit([cacheTags.storeBranding]);
  return input;
}
