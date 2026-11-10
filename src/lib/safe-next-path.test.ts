import { describe, expect, it } from 'vitest';

import { safeNextPath } from './safe-next-path';

describe('safeNextPath', () => {
  it.each(['/account', '/account/addresses?tab=all', '/'])('keeps the local path %s', (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    ['nothing', null],
    ['an absolute URL', 'https://evil.example/account'],
    ['a protocol-relative URL', '//evil.example/account'],
    ['a backslash trick', '/\\evil.example'],
    ['a relative path', 'account'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a newline', '/account\nSet-Cookie: x=1'],
    ['a tab', '/\t/evil.example'],
    ['an over-long path', `/${'a'.repeat(600)}`],
  ])('rejects %s', (_label, candidate) => {
    expect(safeNextPath(candidate)).toBeNull();
  });
});
