import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { categorySeeds, productSeeds } from '../../prisma/seed/catalogue-data';
import { productImageUrl } from '../../prisma/seed/catalogue.seed';
import {
  catalogueArtProductSlugs,
  cataloguePhotoCredits,
  productImageFor,
  productPhotoUrl,
  categoryArtUrl,
  displayImageUrl,
  productArtUrl,
} from '../../src/modules/catalogue/catalogue-art';

const publicFile = (url: string) => path.join(process.cwd(), 'public', url);

describe('bundled demo catalogue art', () => {
  it('covers exactly the seeded products, with three existing views each', () => {
    expect(new Set(productSeeds.map(({ slug }) => slug))).toEqual(catalogueArtProductSlugs);
    for (const slug of catalogueArtProductSlugs) {
      for (const view of [0, 1, 2])
        expect(existsSync(publicFile(productArtUrl(slug, view))), slug).toBe(true);
    }
  });

  it('maps every image URL the seed stored (3 per product) to that product’s own image', () => {
    for (const { slug } of productSeeds) {
      for (const position of [0, 1, 2]) {
        expect(displayImageUrl(productImageUrl(slug, position))).toBe(
          productImageFor(slug, position),
        );
      }
    }
  });

  it('pictures every seeded category with an existing image', () => {
    for (const { slug } of categorySeeds) {
      const url = categoryArtUrl(slug);
      expect(url, slug).not.toBeNull();
      expect(existsSync(publicFile(url ?? '')), slug).toBe(true);
    }
  });

  it('replaces exactly the seeded placeholder URLs with the product’s own image', () => {
    expect(displayImageUrl('https://picsum.photos/seed/ribbed-crop-top-0/800/800')).toBe(
      productImageFor('ribbed-crop-top', 0),
    );
    expect(displayImageUrl('https://picsum.photos/seed/banarasi-silk-saree-2/800/800')).toBe(
      productImageFor('banarasi-silk-saree', 2),
    );
    expect(displayImageUrl('https://picsum.photos/seed/banner-festive/1600/500')).toBe(
      '/catalogue-art/banners/festive.svg',
    );
    for (const banner of ['festive', 'electronics', 'expired-summer']) {
      expect(existsSync(publicFile(`/catalogue-art/banners/${banner}.svg`))).toBe(true);
    }
  });

  it('leaves every other URL as it is (admin images, unknown slugs, other sizes)', () => {
    for (const url of [
      'https://picsum.photos/seed/e2e-banner/1200/400',
      'https://picsum.photos/seed/some-new-product-0/800/800',
      'https://picsum.photos/seed/ribbed-crop-top-0/600/800',
      'https://picsum.photos/seed/ribbed-crop-top-3/800/800',
      'https://example.com/seed/ribbed-crop-top-0/800/800',
    ]) {
      expect(displayImageUrl(url)).toBe(url);
    }
  });
});

describe('bundled product photographs (Wikimedia Commons)', () => {
  const allowedLicence = /^(CC0|Public domain|PD|CC BY(-SA)? \d\.\d)/i;
  const photoDirectory = path.join(process.cwd(), 'public', 'catalogue-photos', 'products');

  it('every photo is credited with an open licence, its source and its author', () => {
    for (const credit of cataloguePhotoCredits) {
      expect(catalogueArtProductSlugs.has(credit.slug), credit.slug).toBe(true);
      expect(credit.license, credit.slug).toMatch(allowedLicence);
      expect(credit.license, credit.slug).not.toMatch(/NC|ND/);
      expect(credit.sourceUrl, credit.slug).toMatch(
        /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/,
      );
      expect(credit.author.trim(), credit.slug).not.toBe('');
      expect(existsSync(path.join(photoDirectory, `${credit.slug}.jpg`)), credit.slug).toBe(true);
    }
    expect(new Set(cataloguePhotoCredits.map(({ slug }) => slug)).size).toBe(
      cataloguePhotoCredits.length,
    );
    expect(new Set(cataloguePhotoCredits.map(({ title }) => title)).size).toBe(
      cataloguePhotoCredits.length,
    );
  });

  it('no photo is bundled without a credit', () => {
    const files = existsSync(photoDirectory) ? readdirSync(photoDirectory) : [];
    const credited = new Set(cataloguePhotoCredits.map(({ slug }) => `${slug}.jpg`));
    expect(files.filter((file) => !credited.has(file))).toEqual([]);
  });

  it('a photographed product shows its photo in every view; others keep their drawn views', () => {
    for (const slug of catalogueArtProductSlugs) {
      const photo = productPhotoUrl(slug);
      for (const view of [0, 1, 2]) {
        expect(productImageFor(slug, view)).toBe(photo ?? productArtUrl(slug, view));
      }
    }
  });
});
