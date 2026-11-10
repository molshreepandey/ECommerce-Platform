import { getDatabase } from '@/lib/db';
import type { DatabaseClient } from '@/lib/db';
import {
  type CatalogueActor,
  jsonText,
  recordCatalogueEvent,
} from '@/modules/catalogue/catalogue-audit';
import { lockProductsInIdOrder } from '@/modules/catalogue/product.repository';
import { assertStaffPermission, type StaffContext } from '@/modules/identity/access-control';
import { enqueueProductsReindex } from '@/modules/search/search-outbox.repository';
import { taxonomyErrors } from '@/modules/taxonomy/taxonomy.errors';

import { exceedsCapacity, isSameMemberSet } from './group-rules';
import { groupingErrors } from './grouping.errors';
import type {
  AddGroupMembersInput,
  CreateProductGroupInput,
  ListProductGroupsInput,
  RenameProductGroupInput,
  SetGroupMembersInput,
} from './grouping.schema';
import {
  addMembers,
  clearMembership,
  deleteProductGroupRow,
  findProductGroup,
  type GroupMemberRow,
  insertProductGroup,
  listGroupMembers,
  listProductGroupRows,
  lockProductGroup,
  type ProductGroupRow,
  refreshMemberCount,
  renameProductGroupRow,
  setMemberOrder,
} from './product-group.repository';

export interface ProductGroupDetail extends ProductGroupRow {
  members: GroupMemberRow[];
}

async function lockExistingGroup(transaction: DatabaseClient, groupId: string) {
  const group = await lockProductGroup(transaction, groupId);
  if (group === null) throw groupingErrors.groupNotFound();
  return group;
}

async function detail(transaction: DatabaseClient, groupId: string): Promise<ProductGroupDetail> {
  const group = await findProductGroup(transaction, groupId);
  if (group === null) throw groupingErrors.groupNotFound();
  return { ...group, members: await listGroupMembers(transaction, groupId) };
}

// Multi-row updates first lock the member products in id order (the same order tagging uses).
async function lockMembers(
  transaction: DatabaseClient,
  groupId: string,
): Promise<GroupMemberRow[]> {
  const members = await listGroupMembers(transaction, groupId);
  await lockProductsInIdOrder(
    transaction,
    members.map(({ id }) => id),
  );
  return members;
}

function memberOrderText(members: readonly GroupMemberRow[]): string {
  return jsonText(
    members.map(({ id, groupSwatchLabel }) => ({ id, swatchLabel: groupSwatchLabel })),
  );
}

export async function listProductGroups(
  staff: StaffContext,
  input: ListProductGroupsInput,
): Promise<ProductGroupRow[]> {
  assertStaffPermission(staff, 'catalogue.read');
  return await listProductGroupRows(getDatabase(), input.search);
}

export async function getProductGroup(
  staff: StaffContext,
  groupId: string,
): Promise<ProductGroupDetail> {
  assertStaffPermission(staff, 'catalogue.read');
  return await detail(getDatabase(), groupId);
}

export async function createProductGroup(
  actor: CatalogueActor,
  input: CreateProductGroupInput,
): Promise<ProductGroupRow> {
  assertStaffPermission(actor.staff, 'taxonomy.write');
  return await getDatabase().$transaction(async (transaction) => {
    const group = await insertProductGroup(transaction, input.name);
    await recordCatalogueEvent(transaction, actor, {
      action: 'grouping.group_created',
      entityType: 'product_group',
      entityId: group.id,
      after: { name: group.name },
    });
    return group;
  });
}

export async function renameProductGroup(
  actor: CatalogueActor,
  groupId: string,
  input: RenameProductGroupInput,
): Promise<ProductGroupRow> {
  assertStaffPermission(actor.staff, 'taxonomy.write');
  return await getDatabase().$transaction(async (transaction) => {
    const before = await lockExistingGroup(transaction, groupId);
    const after = await renameProductGroupRow(transaction, groupId, input.name);
    await recordCatalogueEvent(transaction, actor, {
      action: 'grouping.group_renamed',
      entityType: 'product_group',
      entityId: groupId,
      before: { name: before.name },
      after: { name: after.name },
    });
    return after;
  });
}

// Deleting ungroups every member (archived ones too) and keeps the full member list in the audit row.
export async function deleteProductGroup(actor: CatalogueActor, groupId: string): Promise<void> {
  assertStaffPermission(actor.staff, 'taxonomy.write');
  await getDatabase().$transaction(async (transaction) => {
    const group = await lockExistingGroup(transaction, groupId);
    const members = await lockMembers(transaction, groupId);
    const memberIds = members.map(({ id }) => id);
    await clearMembership(transaction, { groupId, productIds: memberIds });
    await deleteProductGroupRow(transaction, groupId);
    await recordCatalogueEvent(transaction, actor, {
      action: 'grouping.group_deleted',
      entityType: 'product_group',
      entityId: groupId,
      before: {
        name: group.name,
        memberCount: memberIds.length,
        members: memberOrderText(members),
      },
    });
    await enqueueProductsReindex(transaction, memberIds);
  });
}

export async function addGroupMembers(
  actor: CatalogueActor,
  groupId: string,
  input: AddGroupMembersInput,
): Promise<ProductGroupDetail> {
  assertStaffPermission(actor.staff, 'taxonomy.write');
  return await getDatabase().$transaction(async (transaction) => {
    const group = await lockExistingGroup(transaction, groupId);
    const products = await lockProductsInIdOrder(transaction, input.productIds);
    const found = new Set(products.map(({ id }) => id));
    const missing = input.productIds.filter((id) => !found.has(id));
    if (missing.length > 0) throw taxonomyErrors.productsNotFound(missing);
    const archived = products.filter(({ status }) => status === 'ARCHIVED').map(({ id }) => id);
    if (archived.length > 0) throw taxonomyErrors.productsArchived(archived);
    const elsewhere = products
      .filter(({ productGroupId }) => productGroupId !== null && productGroupId !== groupId)
      .map(({ id }) => id);
    if (elsewhere.length > 0) throw groupingErrors.inAnotherGroup(elsewhere);

    const alreadyMembers = new Set(
      products.filter(({ productGroupId }) => productGroupId === groupId).map(({ id }) => id),
    );
    const adding = input.productIds.filter((id) => !alreadyMembers.has(id));
    if (exceedsCapacity({ memberCount: group.memberCount, adding: adding.length })) {
      throw groupingErrors.groupFull(group.memberCount);
    }
    if (adding.length > 0) {
      await addMembers(transaction, {
        groupId,
        productIds: adding,
        firstDisplayOrder: group.memberCount + 1,
      });
      const memberCount = await refreshMemberCount(transaction, groupId);
      await recordCatalogueEvent(transaction, actor, {
        action: 'grouping.members_added',
        entityType: 'product_group',
        entityId: groupId,
        after: { productIds: jsonText(adding), memberCount },
      });
      await enqueueProductsReindex(transaction, adding);
    }
    return await detail(transaction, groupId);
  });
}

// Removing is allowed for archived products too, so a group can always be cleaned up.
export async function removeGroupMember(
  actor: CatalogueActor,
  groupId: string,
  productId: string,
): Promise<ProductGroupDetail> {
  assertStaffPermission(actor.staff, 'taxonomy.write');
  return await getDatabase().$transaction(async (transaction) => {
    await lockExistingGroup(transaction, groupId);
    const members = await lockMembers(transaction, groupId);
    if (!members.some(({ id }) => id === productId)) throw groupingErrors.notInGroup();
    await clearMembership(transaction, { groupId, productIds: [productId] });
    const remaining = members.filter(({ id }) => id !== productId);
    await setMemberOrder(transaction, {
      groupId,
      members: remaining.map(({ id, groupSwatchLabel }) => ({
        productId: id,
        swatchLabel: groupSwatchLabel,
      })),
    });
    const memberCount = await refreshMemberCount(transaction, groupId);
    await recordCatalogueEvent(transaction, actor, {
      action: 'grouping.member_removed',
      entityType: 'product_group',
      entityId: groupId,
      before: { productId },
      after: { memberCount },
    });
    await enqueueProductsReindex(
      transaction,
      members.map(({ id }) => id),
    );
    return await detail(transaction, groupId);
  });
}

// The full list, in display order, with swatch labels; it must match the current members exactly.
export async function setGroupMembers(
  actor: CatalogueActor,
  groupId: string,
  input: SetGroupMembersInput,
): Promise<ProductGroupDetail> {
  assertStaffPermission(actor.staff, 'taxonomy.write');
  return await getDatabase().$transaction(async (transaction) => {
    await lockExistingGroup(transaction, groupId);
    const before = await lockMembers(transaction, groupId);
    const requestedIds = input.members.map(({ productId }) => productId);
    if (
      !isSameMemberSet(
        before.map(({ id }) => id),
        requestedIds,
      )
    ) {
      throw groupingErrors.staleMembers();
    }
    await setMemberOrder(transaction, { groupId, members: input.members });
    const after = await listGroupMembers(transaction, groupId);
    await recordCatalogueEvent(transaction, actor, {
      action: 'grouping.members_reordered',
      entityType: 'product_group',
      entityId: groupId,
      before: { members: memberOrderText(before) },
      after: { members: memberOrderText(after) },
    });
    await enqueueProductsReindex(transaction, requestedIds);
    return await detail(transaction, groupId);
  });
}
