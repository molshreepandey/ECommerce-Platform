import {
  foreignKeyViolationConstraintName,
  getDatabase,
  isForeignKeyViolation,
  isUniqueViolation,
  uniqueViolationConstraintName,
} from '@/lib/db';
import type { DatabaseClient } from '@/lib/db';
import type { AuditData } from '@/modules/audit/audit.types';
import { type CatalogueActor, recordCatalogueEvent } from '@/modules/catalogue/catalogue-audit';
import { CatalogueValidationError } from '@/modules/catalogue/catalogue.errors';
import { slugFromName } from '@/modules/catalogue/slug';
import { assertStaffPermission, type StaffContext } from '@/modules/identity/access-control';
import { enqueueProductsInCategorySubtree } from '@/modules/search/search-outbox.repository';

import { checkMove, childPath, maximumCategoryLevel, subtreeProductCounts } from './category-tree';
import {
  type CategoryRow,
  countChildren,
  countProductsOnCategory,
  deactivateSubtree,
  deleteCategoryRow,
  directProductCounts,
  findCategory,
  insertCategory,
  listCategoryRows,
  listSubtree,
  lockCategoryForUpdate,
  lockCategoryTree,
  nextChildPosition,
  rewriteSubtree,
  updateCategoryRow,
} from './category.repository';
import { taxonomyErrors } from './taxonomy.errors';
import type {
  ChangeCategoryStatusInput,
  CreateCategoryInput,
  MoveCategoryInput,
  UpdateCategoryInput,
} from './taxonomy.schema';

export interface CategoryNode extends CategoryRow {
  childCount: number;
  directProductCount: number;
  productCount: number;
}

function categoryAuditData(category: CategoryRow): AuditData {
  return {
    name: category.name,
    slug: category.slug,
    path: category.path,
    level: category.level,
    parentId: category.parentId,
    isActive: category.isActive,
    position: category.position,
  };
}

function rethrowCategoryConflict(error: unknown): never {
  if (isUniqueViolation(error) && uniqueViolationConstraintName(error) === 'categories_slug_key') {
    throw taxonomyErrors.slugTaken();
  }
  if (
    isForeignKeyViolation(error) &&
    foreignKeyViolationConstraintName(error) === 'products_category_id_fkey'
  ) {
    throw taxonomyErrors.hasProducts(1);
  }
  throw error;
}

async function lockExisting(transaction: DatabaseClient, categoryId: string): Promise<CategoryRow> {
  const category = await lockCategoryForUpdate(transaction, categoryId);
  if (category === null) throw taxonomyErrors.categoryNotFound();
  return category;
}

// A parent that receives children must stay a valid parent: active, not at L4, and not holding products
// (products only live on leaves).
async function assertCanHoldChildren(
  transaction: DatabaseClient,
  parent: CategoryRow,
  childSubtreeHeight: number,
): Promise<void> {
  if (parent.level + 1 + childSubtreeHeight > maximumCategoryLevel) throw taxonomyErrors.tooDeep();
  if (!parent.isActive) throw taxonomyErrors.parentInactive();
  const productCount = await countProductsOnCategory(transaction, parent.id);
  if (productCount > 0) throw taxonomyErrors.hasProducts(productCount);
}

function parentPathOf(category: CategoryRow): string {
  return category.path.slice(0, category.path.length - category.slug.length - 1);
}

export async function listCategoryTree(staff: StaffContext): Promise<CategoryNode[]> {
  assertStaffPermission(staff, 'catalogue.read');
  const database = getDatabase();
  const [rows, directCounts] = await Promise.all([
    listCategoryRows(database),
    directProductCounts(database),
  ]);
  const subtreeCounts = subtreeProductCounts(rows, directCounts);
  return rows.map((row) => ({
    ...row,
    childCount: rows.filter(({ parentId }) => parentId === row.id).length,
    directProductCount: directCounts.get(row.id) ?? 0,
    productCount: subtreeCounts.get(row.id) ?? 0,
  }));
}

export async function createCategory(
  actor: CatalogueActor,
  input: CreateCategoryInput,
): Promise<CategoryRow> {
  assertStaffPermission(actor.staff, 'taxonomy.write');
  const slug = input.slug ?? slugFromName(input.name);
  if (slug === '') throw new CatalogueValidationError({ slug: ['Enter a slug'] });
  try {
    return await getDatabase().$transaction(async (transaction) => {
      await lockCategoryTree(transaction);
      const parent =
        input.parentId === null ? null : await lockExisting(transaction, input.parentId);
      if (parent !== null) await assertCanHoldChildren(transaction, parent, 0);
      const category = await insertCategory(transaction, {
        parentId: parent?.id ?? null,
        level: (parent?.level ?? 0) + 1,
        name: input.name,
        slug,
        path: childPath(parent?.path ?? null, slug),
        position: input.position ?? (await nextChildPosition(transaction, parent?.id ?? null)),
      });
      await recordCatalogueEvent(transaction, actor, {
        action: 'taxonomy.category_created',
        entityType: 'category',
        entityId: category.id,
        after: categoryAuditData(category),
      });
      return category;
    });
  } catch (error) {
    rethrowCategoryConflict(error);
  }
}

// Renaming the slug rewrites the path of the whole subtree, so their products are reindexed too.
export async function updateCategory(
  actor: CatalogueActor,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<CategoryRow> {
  assertStaffPermission(actor.staff, 'taxonomy.write');
  try {
    return await getDatabase().$transaction(async (transaction) => {
      await lockCategoryTree(transaction);
      const before = await lockExisting(transaction, categoryId);
      if (input.slug !== undefined && input.slug !== before.slug) {
        await rewriteSubtree(transaction, {
          categoryId,
          oldPath: before.path,
          newPath: `${parentPathOf(before)}${input.slug}/`,
          levelChange: 0,
          newParentId: before.parentId,
          newSlug: input.slug,
          newPosition: null,
        });
      }
      await updateCategoryRow(transaction, categoryId, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.position === undefined ? {} : { position: input.position }),
      });
      const after = await findCategory(transaction, categoryId);
      if (after === null) throw taxonomyErrors.categoryNotFound();
      await recordCatalogueEvent(transaction, actor, {
        action: 'taxonomy.category_updated',
        entityType: 'category',
        entityId: categoryId,
        before: categoryAuditData(before),
        after: categoryAuditData(after),
      });
      if (after.name !== before.name || after.path !== before.path) {
        await enqueueProductsInCategorySubtree(transaction, after.path);
      }
      return after;
    });
  } catch (error) {
    rethrowCategoryConflict(error);
  }
}

export async function moveCategory(
  actor: CatalogueActor,
  categoryId: string,
  input: MoveCategoryInput,
): Promise<CategoryRow> {
  assertStaffPermission(actor.staff, 'taxonomy.write');
  return await getDatabase().$transaction(async (transaction) => {
    await lockCategoryTree(transaction);
    const node = await lockExisting(transaction, categoryId);
    const newParent =
      input.parentId === null ? null : await lockExisting(transaction, input.parentId);
    const subtree = await listSubtree(transaction, node.path);
    const check = checkMove({ node, newParent, subtree });
    if (!check.allowed) {
      throw check.reason === 'CYCLE' ? taxonomyErrors.moveCycle() : taxonomyErrors.tooDeep();
    }
    if (newParent !== null && newParent.id !== node.parentId) {
      if (!newParent.isActive && node.isActive) throw taxonomyErrors.parentInactive();
      const productCount = await countProductsOnCategory(transaction, newParent.id);
      if (productCount > 0) throw taxonomyErrors.hasProducts(productCount);
    }
    await rewriteSubtree(transaction, {
      categoryId,
      oldPath: node.path,
      newPath: check.newPath,
      levelChange: check.newLevel - node.level,
      newParentId: newParent?.id ?? null,
      newSlug: node.slug,
      newPosition:
        input.position ??
        (newParent?.id === node.parentId
          ? null
          : await nextChildPosition(transaction, newParent?.id ?? null)),
    });
    const after = await findCategory(transaction, categoryId);
    if (after === null) throw taxonomyErrors.categoryNotFound();
    await recordCatalogueEvent(transaction, actor, {
      action: 'taxonomy.category_moved',
      entityType: 'category',
      entityId: categoryId,
      before: categoryAuditData(node),
      after: { ...categoryAuditData(after), movedCategoryCount: subtree.length },
    });
    await enqueueProductsInCategorySubtree(transaction, after.path);
    return after;
  });
}

// Deactivating hides the whole subtree; a category can only be activated under an active parent, so
// "active" always implies every ancestor is active.
export async function changeCategoryStatus(
  actor: CatalogueActor,
  categoryId: string,
  input: ChangeCategoryStatusInput,
): Promise<CategoryRow> {
  assertStaffPermission(actor.staff, 'taxonomy.write');
  return await getDatabase().$transaction(async (transaction) => {
    await lockCategoryTree(transaction);
    const before = await lockExisting(transaction, categoryId);
    if (before.isActive === input.isActive) return before;
    let changedCount = 1;
    if (input.isActive) {
      const parent =
        before.parentId === null ? null : await findCategory(transaction, before.parentId);
      if (parent !== null && !parent.isActive) throw taxonomyErrors.parentInactive();
      await updateCategoryRow(transaction, categoryId, { isActive: true });
    } else {
      changedCount = await deactivateSubtree(transaction, before.path);
    }
    const after = await findCategory(transaction, categoryId);
    if (after === null) throw taxonomyErrors.categoryNotFound();
    await recordCatalogueEvent(transaction, actor, {
      action: 'taxonomy.category_status_changed',
      entityType: 'category',
      entityId: categoryId,
      before: { isActive: before.isActive, path: before.path },
      after: { isActive: after.isActive, path: after.path, changedCategoryCount: changedCount },
    });
    await enqueueProductsInCategorySubtree(transaction, after.path);
    return after;
  });
}

// Only an empty leaf can be deleted (D18); the foreign key from products is the final safeguard.
export async function deleteCategory(actor: CatalogueActor, categoryId: string): Promise<void> {
  assertStaffPermission(actor.staff, 'taxonomy.write');
  try {
    await getDatabase().$transaction(async (transaction) => {
      await lockCategoryTree(transaction);
      const category = await lockExisting(transaction, categoryId);
      const childCount = await countChildren(transaction, categoryId);
      if (childCount > 0) throw taxonomyErrors.hasChildren(childCount);
      const productCount = await countProductsOnCategory(transaction, categoryId);
      if (productCount > 0) throw taxonomyErrors.hasProducts(productCount);
      await deleteCategoryRow(transaction, categoryId);
      await recordCatalogueEvent(transaction, actor, {
        action: 'taxonomy.category_deleted',
        entityType: 'category',
        entityId: categoryId,
        before: categoryAuditData(category),
      });
    });
  } catch (error) {
    rethrowCategoryConflict(error);
  }
}
