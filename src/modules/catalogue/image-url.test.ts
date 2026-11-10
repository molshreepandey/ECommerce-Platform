import { describe, expect, it } from 'vitest';

import { allowedImageOrigins, isAllowedImageUrl } from './image-url';

const origins = allowedImageOrigins([
  'https://picsum.photos',
  'https://fastly.picsum.photos',
  'data:',
  'blob:',
]);

describe('image URLs', () => {
  it('keeps only https sources from the CSP list', () => {
    expect(origins).toEqual(['https://picsum.photos', 'https://fastly.picsum.photos']);
  });

  it('accepts images on an allowed origin', () => {
    expect(isAllowedImageUrl('https://picsum.photos/seed/kurta/600/800', origins)).toBe(true);
    expect(isAllowedImageUrl('https://fastly.picsum.photos/id/1/600/800.jpg?hmac=x', origins)).toBe(
      true,
    );
  });

  it.each([
    'http://picsum.photos/seed/kurta/600/800',
    'https://evil.example/picsum.photos/x.jpg',
    'https://picsum.photos.evil.example/x.jpg',
    'https://user:secret@picsum.photos/x.jpg',
    'https://picsum.photos:8443/x.jpg',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    'not a url',
  ])('refuses %s', (url) => {
    expect(isAllowedImageUrl(url, origins)).toBe(false);
  });
});
