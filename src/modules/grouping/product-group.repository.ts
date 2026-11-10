import { z } from 'zod';

import type { DatabaseClient } from '@/lib/db';

export const productGroupSelect = { id: true, name: true, memberCount: true } as const;

export interface ProductGroupRow {
  id: string;
  name: string;
  memberCount: number;
}

export const groupMemberSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  groupDisplayOrder: true,
  groupSwatchLabel: true,
} as const;

export interface GroupMemberRow {
  id: string;
  name: string;
  slug: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  groupDisplayOrder: number | null;
  groupSwatchLabel: string | null;
}

export function listProductGroupRows(
  database: DatabaseClient,
  search: string | undefined,
): Promise<ProductGroupRow[]> {
  return database.productGroup.findMany({
    where: search === undefined ? {} : { name: { contains: search, mode: 'insensitive' } },
    select: productGroupSelect,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
}

export function findProductGroup(
  database: DatabaseClient,
  groupId: string,
): Promise<ProductGroupRow | null> {
  return database.productGroup.findUnique({ where: { id: groupId }, select: productGroupSelect });
}

// Every change to a group's membership holds this lock, so the 50-member count cannot be raced.
export async function lockProductGroup(
  database: DatabaseClient,
  groupId: string,
): Promise<ProductGroupRow | null> {
  await database.$queryRaw`SELECT id FROM product_groups WHERE id = ${groupId}::uuid FOR UPDATE`;
  return findProductGroup(database, groupId);
}

export function listGroupMembers(
  database: DatabaseClient,
  groupId: string,
): Promise<GroupMemberRow[]> {
  return database.product.findMany({
    where: { productGroupId: groupId },
    select: groupMemberSelect,
    orderBy: [{ groupDisplayOrder: 'asc' }, { id: 'asc' }],
  });
}

export function insertProductGroup(
  database: DatabaseClient,
  name: string,
): Promise<ProductGroupRow> {
  return database.productGroup.create({ data: { name }, select: productGroupSelect });
}

export function renameProductGroupRow(
  database: DatabaseClient,
  groupId: string,
  name: string,
): Promise<ProductGroupRow> {
  return database.productGroup.update({
    where: { id: groupId },
    data: { name },
    select: productGroupSelect,
  });
}

export async function deleteProductGroupRow(
  database: DatabaseClient,
  groupId: string,
): Promise<void> {
  await database.productGroup.delete({ where: { id: groupId }, select: { id: true } });
}

// The callers below hold the group lock and have locked these products in id order first.
export async function addMembers(
  database: DatabaseClient,
  input: { groupId: string; productIds: readonly string[]; firstDisplayOrder: number },
): Promise<void> {
  const ids = [...input.productIds];
  await database.$executeRaw`
    UPDATE products AS product SET
      product_group_id = ${input.groupId}::uuid,
      group_display_order = ${input.firstDisplayOrder}::int + member.ordinality::int - 1,
      group_swatch_label = NULL,
      version = product.version + 1,
      updated_at = now()
    FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS member(id, ordinality)
    WHERE product.id = member.id`;
}

export async function clearMembership(
  database: DatabaseClient,
  input: { groupId: string; productIds: readonly string[] },
): Promise<void> {
  const ids = [...input.productIds];
  await database.$executeRaw`
    UPDATE products SET
      product_group_id = NULL, group_display_order = NULL, group_swatch_label = NULL,
      version = version + 1, updated_at = now()
    WHERE id = ANY(${ids}::uuid[]) AND product_group_id = ${input.groupId}::uuid`;
}

// Order is 1..n in the given sequence; swatch labels are set at the same time.
export async function setMemberOrder(
  database: DatabaseClient,
  input: {
    groupId: string;
    members: readonly { productId: string; swatchLabel: string | null }[];
  },
): Promise<void> {
  const ids = input.members.map(({ productId }) => productId);
  const labels = input.members.map(({ swatchLabel }) => swatchLabel);
  await database.$executeRaw`
    UPDATE products AS product SET
      group_display_order = member.ordinality::int,
      group_swatch_label = member.label,
      version = product.version + 1,
      updated_at = now()
    FROM unnest(${ids}::uuid[], ${labels}::text[]) WITH ORDINALITY AS member(id, label, ordinality)
    WHERE product.id = member.id AND product.product_group_id = ${input.groupId}::uuid`;
}

const memberCountRowsSchema = z.tuple([z.object({ member_count: z.number() })]);

// The stored count is recomputed from the products themselves, under the group lock.
export async function refreshMemberCount(
  database: DatabaseClient,
  groupId: string,
): Promise<number> {
  const [row] = memberCountRowsSchema.parse(
    await database.$queryRaw`
      UPDATE product_groups SET
        member_count = (SELECT count(*) FROM products WHERE product_group_id = ${groupId}::uuid),
        updated_at = now()
      WHERE id = ${groupId}::uuid
      RETURNING member_count`,
  );
  return row.member_count;
}
