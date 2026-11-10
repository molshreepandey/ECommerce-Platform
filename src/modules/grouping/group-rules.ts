// A product belongs to at most one group (products.product_group_id) and a group has at most 50 members
// (a CHECK on product_groups.member_count backs this up).
export const maximumGroupMembers = 50;

export function exceedsCapacity(input: { memberCount: number; adding: number }): boolean {
  return input.memberCount + input.adding > maximumGroupMembers;
}

// A reorder must list exactly the current members: one added or removed meanwhile makes it stale.
export function isSameMemberSet(currentIds: readonly string[], requestedIds: readonly string[]) {
  const current = new Set(currentIds);
  return requestedIds.length === current.size && requestedIds.every((id) => current.has(id));
}
