import type { DatabaseClient } from '@/lib/db';

export function listStoreSettingRows(
  database: DatabaseClient,
  keys: readonly string[],
): Promise<{ key: string; value: unknown }[]> {
  return database.storeSetting.findMany({
    where: { key: { in: [...keys] } },
    select: { key: true, value: true },
  });
}

// Row locks in key order, so two concurrent saves serialise instead of interleaving their before-values.
export async function lockStoreSettingRows(
  database: DatabaseClient,
  keys: readonly string[],
): Promise<void> {
  await database.$queryRaw`
    SELECT key FROM store_settings WHERE key = ANY(${[...keys]}::text[]) ORDER BY key FOR UPDATE`;
}

export async function upsertStoreSettingRows(
  database: DatabaseClient,
  rows: readonly { key: string; value: number | string }[],
): Promise<void> {
  for (const row of rows) {
    await database.storeSetting.upsert({
      where: { key: row.key },
      create: { key: row.key, value: row.value },
      update: { value: row.value },
      select: { key: true },
    });
  }
}

export async function findStoreSettingValue(
  database: DatabaseClient,
  key: string,
): Promise<unknown> {
  const row = await database.storeSetting.findUnique({ where: { key }, select: { value: true } });
  return row?.value ?? null;
}

export async function saveStoreSettingValue(
  database: DatabaseClient,
  key: string,
  value: Record<string, string | null>,
): Promise<void> {
  await database.$queryRaw`SELECT key FROM store_settings WHERE key = ${key} FOR UPDATE`;
  await database.storeSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
    select: { key: true },
  });
}
