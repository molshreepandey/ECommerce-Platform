import { type DatabaseClient, getDatabase } from '@/lib/db';

import { type CategoryRow, listCategoryRows } from './category.repository';

export interface StorefrontCategory {
  id: string;
  name: string;
  slug: string;
  path: string;
  level: number;
  children: StorefrontCategory[];
}

// The storefront tree (C7): active categories whose ancestors are all active, siblings by position then
// name. A deactivated category hides its whole subtree.
export function buildStorefrontCategoryTree(rows: readonly CategoryRow[]): StorefrontCategory[] {
  const childrenByParent = new Map<string | null, CategoryRow[]>();
  for (const row of rows) {
    if (!row.isActive) continue;
    const siblings = childrenByParent.get(row.parentId) ?? [];
    siblings.push(row);
    childrenByParent.set(row.parentId, siblings);
  }
  const build = (parentId: string | null): StorefrontCategory[] =>
    (childrenByParent.get(parentId) ?? [])
      .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name))
      .map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        path: row.path,
        level: row.level,
        children: build(row.id),
      }));
  return build(null);
}

export async function loadStorefrontCategoryTree(
  database: DatabaseClient = getDatabase(),
): Promise<StorefrontCategory[]> {
  return buildStorefrontCategoryTree(await listCategoryRows(database));
}

// Root first, ending at the category with this slug; null when it is not in the storefront tree.
export function findCategoryTrail(
  tree: readonly StorefrontCategory[],
  slug: string,
): StorefrontCategory[] | null {
  for (const category of tree) {
    if (category.slug === slug) return [category];
    const below = findCategoryTrail(category.children, slug);
    if (below !== null) return [category, ...below];
  }
  return null;
}

export function findCategoryTrailById(
  tree: readonly StorefrontCategory[],
  categoryId: string,
): StorefrontCategory[] | null {
  for (const category of tree) {
    if (category.id === categoryId) return [category];
    const below = findCategoryTrailById(category.children, categoryId);
    if (below !== null) return [category, ...below];
  }
  return null;
}
