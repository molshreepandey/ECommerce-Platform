// Category paths are built from slugs: "/apparel/mens-clothing/". A node's subtree is every path that
// starts with its own path, so tree questions become string questions.

export const maximumCategoryLevel = 4;

export interface TreeNode {
  id: string;
  parentId: string | null;
  level: number;
  path: string;
}

export function childPath(parentPath: string | null, slug: string): string {
  return `${parentPath ?? '/'}${slug}/`;
}

export function isInSubtree(candidatePath: string, rootPath: string): boolean {
  return candidatePath.startsWith(rootPath);
}

// How many levels the subtree spans below its root (0 for a leaf).
export function subtreeHeight(root: TreeNode, nodes: readonly TreeNode[]): number {
  return nodes
    .filter((node) => isInSubtree(node.path, root.path))
    .reduce((height, node) => Math.max(height, node.level - root.level), 0);
}

export type MoveCheck =
  | { allowed: true; newLevel: number; newPath: string }
  | { allowed: false; reason: 'CYCLE' | 'TOO_DEEP' };

// Moving under itself or one of its descendants would create a cycle; the deepest node must stay ≤ L4.
export function checkMove(input: {
  node: TreeNode & { slug: string };
  newParent: TreeNode | null;
  subtree: readonly TreeNode[];
}): MoveCheck {
  if (input.newParent !== null && isInSubtree(input.newParent.path, input.node.path)) {
    return { allowed: false, reason: 'CYCLE' };
  }
  const newLevel = (input.newParent?.level ?? 0) + 1;
  if (newLevel + subtreeHeight(input.node, input.subtree) > maximumCategoryLevel) {
    return { allowed: false, reason: 'TOO_DEEP' };
  }
  return {
    allowed: true,
    newLevel,
    newPath: childPath(input.newParent?.path ?? null, input.node.slug),
  };
}

export interface CategoryCountRow {
  id: string;
  path: string;
}

// Product counts per category including every descendant, from one grouped count per category.
export function subtreeProductCounts(
  categories: readonly CategoryCountRow[],
  directCounts: ReadonlyMap<string, number>,
): Map<string, number> {
  return new Map(
    categories.map((category) => [
      category.id,
      categories
        .filter((candidate) => isInSubtree(candidate.path, category.path))
        .reduce((total, candidate) => total + (directCounts.get(candidate.id) ?? 0), 0),
    ]),
  );
}

export interface NamedCategory {
  id: string;
  parentId: string | null;
  name: string;
}

// "Apparel › Men › Shirts", built from names (never slugs). A missing parent ends the chain at the last
// known ancestor, and the walk stops after four levels, so inconsistent data can never loop forever.
export function categoryNameLabels(categories: readonly NamedCategory[]): Map<string, string> {
  const byId = new Map(categories.map((category) => [category.id, category]));
  return new Map(
    categories.map((category) => {
      const names = [category.name];
      let parentId = category.parentId;
      while (parentId !== null && names.length < maximumCategoryLevel) {
        const parent = byId.get(parentId);
        if (parent === undefined) break;
        names.unshift(parent.name);
        parentId = parent.parentId;
      }
      return [category.id, names.join(' › ')];
    }),
  );
}
