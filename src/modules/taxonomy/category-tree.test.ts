import { describe, expect, it } from 'vitest';

import {
  categoryNameLabels,
  checkMove,
  childPath,
  subtreeHeight,
  subtreeProductCounts,
} from './category-tree';

const node = (id: string, path: string, level: number, parentId: string | null = null) => ({
  id,
  path,
  level,
  parentId,
  slug: path.split('/').at(-2) ?? id,
});

const apparel = node('a', '/apparel/', 1);
const men = node('m', '/apparel/men/', 2, 'a');
const topwear = node('t', '/apparel/men/topwear/', 3, 'm');
const shirts = node('s', '/apparel/men/topwear/shirts/', 4, 't');
const footwear = node('f', '/footwear/', 1);
const sneakers = node('k', '/footwear/sneakers/', 2, 'f');
const tree = [apparel, men, topwear, shirts, footwear, sneakers];

describe('childPath', () => {
  it('appends the slug to the parent path, or starts a root path', () => {
    expect(childPath(null, 'apparel')).toBe('/apparel/');
    expect(childPath('/apparel/', 'men')).toBe('/apparel/men/');
  });
});

describe('subtreeHeight', () => {
  it('counts levels below the node', () => {
    expect(subtreeHeight(apparel, tree)).toBe(3);
    expect(subtreeHeight(topwear, tree)).toBe(1);
    expect(subtreeHeight(shirts, tree)).toBe(0);
  });

  it('does not confuse a sibling whose slug starts the same way', () => {
    const menswear = node('w', '/apparel/menswear/', 2, 'a');
    expect(subtreeHeight(men, [...tree, node('x', '/apparel/menswear/x/', 3, 'w'), menswear])).toBe(
      2,
    );
  });
});

describe('checkMove', () => {
  it('refuses a move under the node itself or any descendant (cycle)', () => {
    for (const newParent of [men, topwear, shirts]) {
      expect(checkMove({ node: men, newParent, subtree: tree })).toEqual({
        allowed: false,
        reason: 'CYCLE',
      });
    }
  });

  it('refuses a move that would push the deepest descendant below level 4', () => {
    expect(checkMove({ node: men, newParent: sneakers, subtree: tree })).toEqual({
      allowed: false,
      reason: 'TOO_DEEP',
    });
    // Exactly reaching level 4 is allowed: topwear's child ends up at L4 under footwear/sneakers.
    expect(checkMove({ node: topwear, newParent: sneakers, subtree: tree })).toMatchObject({
      allowed: true,
      newLevel: 3,
    });
  });

  it('allows a move that keeps the subtree within four levels and gives the new path', () => {
    expect(checkMove({ node: topwear, newParent: footwear, subtree: tree })).toEqual({
      allowed: true,
      newLevel: 2,
      newPath: '/footwear/topwear/',
    });
    expect(checkMove({ node: men, newParent: null, subtree: tree })).toEqual({
      allowed: true,
      newLevel: 1,
      newPath: '/men/',
    });
  });
});

describe('subtreeProductCounts', () => {
  it('adds every descendant’s products to each ancestor', () => {
    const counts = subtreeProductCounts(
      tree,
      new Map([
        ['s', 3],
        ['k', 2],
      ]),
    );
    expect(Object.fromEntries(counts)).toEqual({ a: 3, m: 3, t: 3, s: 3, f: 2, k: 2 });
  });
});

describe('categoryNameLabels', () => {
  const named = (id: string, name: string, parentId: string | null) => ({ id, name, parentId });

  it('uses the name alone for a root and joins names (not slugs) down the tree', () => {
    const labels = categoryNameLabels([
      named('a', 'Apparel', null),
      named('m', 'Men', 'a'),
      named('s', 'Shirts', 'm'),
    ]);
    expect(labels.get('a')).toBe('Apparel');
    expect(labels.get('s')).toBe('Apparel › Men › Shirts');
  });

  it('stops at the last known ancestor when a parent is missing', () => {
    const labels = categoryNameLabels([named('m', 'Men', 'gone'), named('s', 'Shirts', 'm')]);
    expect(labels.get('m')).toBe('Men');
    expect(labels.get('s')).toBe('Men › Shirts');
  });

  it('never loops on inconsistent data that points in a circle', () => {
    const labels = categoryNameLabels([named('x', 'X', 'y'), named('y', 'Y', 'x')]);
    expect(labels.get('x')?.split(' › ')).toHaveLength(4);
  });
});
