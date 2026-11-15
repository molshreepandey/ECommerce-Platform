import { cacheTags, expireCacheTagsAfterCommit } from '@/lib/cache-tags';
import { type DatabaseClient, getDatabase } from '@/lib/db';
import { recordAuditEvent } from '@/modules/audit/audit.service';
import {
  assertStaffPermission,
  type RequestMetadata,
  type StaffContext,
} from '@/modules/identity/access-control';

import {
  defaultStoreSettings,
  storeSettingKeys,
  type StoreSettings,
  storeSettingsSchema,
} from './store-settings.schema';
import {
  listStoreSettingRows,
  lockStoreSettingRows,
  upsertStoreSettingRows,
} from './store-settings.repository';

const settingFields = storeSettingsSchema.keyof().options;
const settingKeys = Object.values(storeSettingKeys);

// Reads straight from PostgreSQL (checkout passes its transaction); pages use the cached copy.
export async function loadStoreSettings(
  database: DatabaseClient = getDatabase(),
): Promise<StoreSettings> {
  const valueByKey = new Map(
    (await listStoreSettingRows(database, settingKeys)).map(({ key, value }) => [key, value]),
  );
  return storeSettingsSchema.parse(
    Object.fromEntries(
      settingFields.map((field) => [
        field,
        valueByKey.get(storeSettingKeys[field]) ?? defaultStoreSettings[field],
      ]),
    ),
  );
}

export function getStoreSettingsForStaff(staff: StaffContext): Promise<StoreSettings> {
  assertStaffPermission(staff, 'settings.write');
  return loadStoreSettings();
}

// D47: one audit row with every changed value before → after; the cached copy expires after commit.
export async function updateStoreSettings(
  staff: StaffContext,
  input: StoreSettings,
  metadata: RequestMetadata,
): Promise<StoreSettings> {
  assertStaffPermission(staff, 'settings.write');
  const updated = await getDatabase().$transaction(async (transaction) => {
    await lockStoreSettingRows(transaction, settingKeys);
    const before = await loadStoreSettings(transaction);
    const changedFields = settingFields.filter((field) => before[field] !== input[field]);
    if (changedFields.length === 0) return before;
    await upsertStoreSettingRows(
      transaction,
      changedFields.map((field) => ({ key: storeSettingKeys[field], value: input[field] })),
    );
    await recordAuditEvent(transaction, {
      actorType: 'STAFF',
      actorId: staff.staffUserId,
      action: 'settings.updated',
      entityType: 'store_settings',
      entityId: 'store',
      before: Object.fromEntries(changedFields.map((field) => [field, before[field]])),
      after: Object.fromEntries(changedFields.map((field) => [field, input[field]])),
      ipAddress: metadata.clientIp,
      requestId: metadata.requestId,
    });
    return input;
  });
  await expireCacheTagsAfterCommit([cacheTags.storeSettings]);
  return updated;
}
