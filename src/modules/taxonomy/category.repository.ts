import { z } from 'zod';

import type { DatabaseClient } from '@/lib/db';

export const categorySelect = {
  id: true,
  parentId: true,
  level: true,
  name: true,
  slug: true,
  path: true,
  isActive: true,
  position: true,
} as const;

export interface CategoryRow {
  id: string;
  parentId: string | null;
  level: number;
  name: string;
  slug: string;
  path: string;
  isActive: boolean;
  position: number;
}

// One key for the whole tree: create, move, rename and delete run one at a time, so two opposite moves
// can never both pass the cycle check. Tree edits are rare admin actions, so the queue is short.
const categoryTreeLockKey = 4_101_001;

export async function lockCategoryTree(database: DatabaseClient): Promise<void> {
  await database.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(${categoryTreeLockKey}::bigint)) AS tree_lock`;
}

// FOR UPDATE when changing the category itself or adding children; tagging takes FOR SHARE.
export async function lockCategoryForUpdate(
  database: DatabaseClient,
  categoryId: string,
): Promise<CategoryRow | null> {
  await database.$queryRaw`SELECT id FROM categories WHERE id = ${categoryId}::uuid FOR UPDATE`;
  return findCategory(database, categoryId);
}

export async function lockCategoryForShare(
  database: DatabaseClient,
  categoryId: string,
): Promise<CategoryRow | null> {
  await database.$queryRaw`SELECT id FROM categories WHERE id = ${categoryId}::uuid FOR SHARE`;
  return findCategory(database, categoryId);
}

export function findCategory(
  database: DatabaseClient,
  categoryId: string,
): Promise<CategoryRow | null> {
  return database.category.findUnique({ where: { id: categoryId }, select: categorySelect });
}

export function listCategoryRows(database: DatabaseClient): Promise<CategoryRow[]> {
  return database.category.findMany({
    select: categorySelect,
    orderBy: [{ path: 'asc' }],
  });
}

export function listSubtree(database: DatabaseClient, rootPath: string): Promise<CategoryRow[]> {
  return database.category.findMany({
    where: { path: { startsWith: rootPath } },
    select: categorySelect,
  });
}

export function countChildren(database: DatabaseClient, categoryId: string): Promise<number> {
  return database.category.count({ where: { parentId: categoryId } });
}

// Archived products count too: they keep their category and could be restored.
export function countProductsOnCategory(
  database: DatabaseClient,
  categoryId: string,
): Promise<number> {
  return database.product.count({ where: { categoryId } });
}

export async function directProductCounts(database: DatabaseClient): Promise<Map<string, number>> {
  const rows = await database.product.groupBy({
    by: ['categoryId'],
    where: { categoryId: { not: null }, status: { not: 'ARCHIVED' } },
    _count: { _all: true },
  });
  return new Map(
    rows.flatMap((row) => (row.categoryId === null ? [] : [[row.categoryId, row._count._all]])),
  );
}

export function nextChildPosition(
  database: DatabaseClient,
  parentId: string | null,
): Promise<number> {
  return database.category
    .aggregate({ where: { parentId }, _max: { position: true } })
    .then(({ _max }) => (_max.position ?? -1) + 1);
}

export function insertCategory(
  database: DatabaseClient,
  data: Omit<CategoryRow, 'id' | 'isActive'>,
): Promise<CategoryRow> {
  return database.category.create({ data, select: categorySelect });
}

export function updateCategoryRow(
  database: DatabaseClient,
  categoryId: string,
  data: Partial<Pick<CategoryRow, 'name' | 'position' | 'isActive'>>,
): Promise<CategoryRow> {
  return database.category.update({ where: { id: categoryId }, data, select: categorySelect });
}

// One statement moves the node and rewrites its whole subtree, so the per-row CHECKs (root ⇔ level 1,
// level 1–4) only ever see consistent rows.
export async function rewriteSubtree(
  database: DatabaseClient,
  input: {
    categoryId: string;
    oldPath: string;
    newPath: string;
    levelChange: number;
    newParentId: string | null;
    newSlug: string;
    newPosition: number | null;
  },
): Promise<number> {
  return database.$executeRaw`
    UPDATE categories SET
      path = ${input.newPath} || substr(path, ${input.oldPath.length + 1}),
      level = level + ${input.levelChange},
      parent_id = CASE WHEN id = ${input.categoryId}::uuid THEN ${input.newParentId}::uuid ELSE parent_id END,
      slug = CASE WHEN id = ${input.categoryId}::uuid THEN ${input.newSlug} ELSE slug END,
      position = CASE WHEN id = ${input.categoryId}::uuid AND ${input.newPosition}::int IS NOT NULL
                      THEN ${input.newPosition}::int ELSE position END,
      updated_at = now()
    WHERE path LIKE ${input.oldPath} || '%'`;
}

export function deactivateSubtree(database: DatabaseClient, rootPath: string): Promise<number> {
  return database.$executeRaw`
    UPDATE categories SET is_active = false, updated_at = now()
    WHERE path LIKE ${rootPath} || '%' AND is_active`;
}

export async function deleteCategoryRow(
  database: DatabaseClient,
  categoryId: string,
): Promise<void> {
  await database.category.delete({ where: { id: categoryId }, select: { id: true } });
}

const idRowsSchema = z.array(z.object({ id: z.string() }));

export async function productIdsInSubtree(
  database: DatabaseClient,
  rootPath: string,
): Promise<string[]> {
  const rows = idRowsSchema.parse(
    await database.$queryRaw`
      SELECT p.id::text AS id FROM products p JOIN categories c ON c.id = p.category_id
      WHERE c.path LIKE ${rootPath} || '%'`,
  );
  return rows.map(({ id }) => id);
}
