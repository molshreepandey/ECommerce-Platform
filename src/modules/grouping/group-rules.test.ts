import { describe, expect, it } from 'vitest';

import { exceedsCapacity, isSameMemberSet, maximumGroupMembers } from './group-rules';

describe('exceedsCapacity', () => {
  it('allows up to 50 members and refuses the 51st', () => {
    expect(maximumGroupMembers).toBe(50);
    expect(exceedsCapacity({ memberCount: 49, adding: 1 })).toBe(false);
    expect(exceedsCapacity({ memberCount: 50, adding: 1 })).toBe(true);
    expect(exceedsCapacity({ memberCount: 0, adding: 51 })).toBe(true);
  });
});

describe('isSameMemberSet', () => {
  it('needs exactly the current members, in any order', () => {
    expect(isSameMemberSet(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    expect(isSameMemberSet(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
    expect(isSameMemberSet(['a', 'b'], ['a', 'b', 'x'])).toBe(false);
    expect(isSameMemberSet(['a', 'b'], ['a', 'x'])).toBe(false);
  });
});
