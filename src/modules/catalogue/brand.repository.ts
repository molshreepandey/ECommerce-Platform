import type { DatabaseClient } from '@/lib/db';

export const brandSelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  isActive: true,
} as const;

export interface BrandRow {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  isActive: boolean;
}

export function listBrandRows(database: DatabaseClient): Promise<BrandRow[]> {
  return database.brand.findMany({ select: brandSelect, orderBy: { name: 'asc' } });
}

export function findBrand(database: DatabaseClient, brandId: string): Promise<BrandRow | null> {
  return database.brand.findUnique({ where: { id: brandId }, select: brandSelect });
}

export function insertBrand(
  database: DatabaseClient,
  data: { name: string; slug: string; logoUrl: string | null },
): Promise<BrandRow> {
  return database.brand.create({ data, select: brandSelect });
}

export function updateBrandRow(
  database: DatabaseClient,
  brandId: string,
  data: Partial<Omit<BrandRow, 'id'>>,
): Promise<BrandRow> {
  return database.brand.update({ where: { id: brandId }, data, select: brandSelect });
}

// Serialises changes to one brand, and lets a product write see whether the brand is still active.
export async function lockBrand(
  database: DatabaseClient,
  brandId: string,
): Promise<BrandRow | null> {
  await database.$queryRaw`SELECT id FROM brands WHERE id = ${brandId}::uuid FOR SHARE`;
  return findBrand(database, brandId);
}
