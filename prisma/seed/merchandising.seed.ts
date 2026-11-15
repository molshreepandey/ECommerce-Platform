import type { SeedClient } from './seed-client';
import { daysFromSeedDay } from './seed-clock';
import { deterministicUuidV7, requireValue } from './seed-ids';

const collectionSeeds = [
  {
    slug: 'festive-edit',
    name: 'Festive Edit',
    description: 'Kurtas, sarees and sandals for the season',
    productSlugs: [
      'anarkali-kurta-indigo-print',
      'anarkali-kurta-rust-print',
      'banarasi-silk-saree',
      'strappy-flat-sandal',
      'velvet-matte-lipstick',
    ],
  },
  {
    slug: 'work-from-anywhere',
    name: 'Work From Anywhere',
    description: 'Laptops, chargers and audio for remote work',
    productSlugs: [
      'nimbus-air-14-laptop',
      'voltix-creator-16-laptop',
      'voltix-65w-gan-charger',
      'voltix-airbuds-pro',
    ],
  },
] as const;

const bannerSeeds = [
  {
    key: 'festive',
    title: 'Festive Edit is live',
    linkUrl: '/collections/festive-edit',
    startsAtDay: -10,
    endsAtDay: 30,
  },
  {
    key: 'electronics',
    title: 'Upgrade your phone',
    linkUrl: '/categories/smartphones',
    startsAtDay: -5,
    endsAtDay: 60,
  },
  {
    key: 'expired-summer',
    title: 'Summer sale (ended)',
    linkUrl: '/categories/apparel',
    startsAtDay: -40,
    endsAtDay: -1,
  },
] as const;

export async function seedMerchandising(
  client: SeedClient,
  productIdBySlug: Map<string, string>,
): Promise<void> {
  for (const collectionSeed of collectionSeeds) {
    const collectionFields = {
      name: collectionSeed.name,
      description: collectionSeed.description,
      startsAt: daysFromSeedDay(-10),
      endsAt: null,
    };
    const collection = await client.collection.upsert({
      where: { slug: collectionSeed.slug },
      create: { slug: collectionSeed.slug, ...collectionFields },
      update: collectionFields,
      select: { id: true },
    });
    await client.collectionProduct.createMany({
      data: collectionSeed.productSlugs.map((productSlug, position) => ({
        collectionId: collection.id,
        productId: requireValue(productIdBySlug.get(productSlug), `product ${productSlug}`),
        position,
      })),
      skipDuplicates: true,
    });
  }

  for (const [position, bannerSeed] of bannerSeeds.entries()) {
    const bannerId = deterministicUuidV7(
      `banner:${bannerSeed.key}`,
      daysFromSeedDay(bannerSeed.startsAtDay),
    );
    const bannerFields = {
      title: bannerSeed.title,
      imageUrl: `https://picsum.photos/seed/banner-${bannerSeed.key}/1600/500`,
      linkUrl: bannerSeed.linkUrl,
      position,
      startsAt: daysFromSeedDay(bannerSeed.startsAtDay),
      endsAt: daysFromSeedDay(bannerSeed.endsAtDay),
    };
    await client.banner.upsert({
      where: { id: bannerId },
      create: { id: bannerId, ...bannerFields },
      update: bannerFields,
    });
  }
}
