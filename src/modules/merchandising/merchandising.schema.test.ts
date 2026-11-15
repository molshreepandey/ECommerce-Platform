import { describe, expect, it } from 'vitest';
import { bannerSchema, isWithinWindow } from './merchandising.schema';

const now = new Date('2026-11-14T10:00:00Z');

describe('isWithinWindow (expired banners are hidden)', () => {
  it.each([
    [{ isActive: true, startsAt: null, endsAt: null }, true],
    [{ isActive: false, startsAt: null, endsAt: null }, false],
    [{ isActive: true, startsAt: new Date('2026-11-15T00:00:00Z'), endsAt: null }, false],
    [{ isActive: true, startsAt: null, endsAt: new Date('2026-11-14T10:00:00Z') }, false],
    [
      {
        isActive: true,
        startsAt: new Date('2026-11-01T00:00:00Z'),
        endsAt: new Date('2026-12-01T00:00:00Z'),
      },
      true,
    ],
  ])('%j → %s', (banner, expected) => {
    expect(isWithinWindow(banner, now)).toBe(expected);
  });
});

describe('bannerSchema', () => {
  const banner = {
    title: 'Sale',
    imageUrl: 'https://picsum.photos/1',
    position: 0,
    isActive: true,
    startsAt: null,
    endsAt: null,
  };
  it('accepts store paths and refuses other sites', () => {
    expect(bannerSchema.safeParse({ ...banner, linkUrl: '/search?q=kurta' }).success).toBe(true);
    for (const linkUrl of ['https://evil.example', '//evil.example', 'javascript:alert(1)']) {
      expect(bannerSchema.safeParse({ ...banner, linkUrl }).success).toBe(false);
    }
  });
});
