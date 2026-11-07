import { Prisma } from '../../src/generated/prisma/client';
import type { AttributeValue, ProductSeed } from './catalogue-data';
import {
  brandSeeds,
  categorySeeds,
  packageDimensions,
  productGroupSeeds,
  productSeeds,
  productTypeSeeds,
} from './catalogue-data';
import type { SeedClient } from './seed-client';
import { daysFromSeedDay } from './seed-clock';
import { deterministicUuidV7, requireValue } from './seed-ids';

export interface SeededVariant {
  id: string;
  sku: string;
  productId: string;
  productSlug: string;
  productName: string;
  brandName: string;
  productStatus: ProductSeed['status'];
  optionValues: Record<string, string>;
  pricePaise: number;
  mrpPaise: number;
  taxRateBasisPoints: number;
  imageUrl: string;
}

export interface SeededCatalogue {
  variants: SeededVariant[];
  productIdBySlug: Map<string, string>;
}

const catalogueCreatedAt = daysFromSeedDay(-50);

function toJsonValue(attributes: Readonly<Record<string, AttributeValue>>): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(attributes).map(([code, value]) => [
      code,
      typeof value === 'object' ? [...value] : value,
    ]),
  );
}

async function seedProductTypes(client: SeedClient): Promise<Map<string, string>> {
  const productTypeIdByCode = new Map<string, string>();
  for (const productTypeSeed of productTypeSeeds) {
    const productType = await client.productType.upsert({
      where: { code: productTypeSeed.code },
      create: {
        code: productTypeSeed.code,
        name: productTypeSeed.name,
        description: productTypeSeed.description,
        createdAt: catalogueCreatedAt,
      },
      update: { name: productTypeSeed.name, description: productTypeSeed.description },
      select: { id: true },
    });
    productTypeIdByCode.set(productTypeSeed.code, productType.id);

    for (const [displayOrder, definition] of productTypeSeed.attributeDefinitions.entries()) {
      const definitionFields = {
        label: definition.label,
        dataType: definition.dataType,
        scope: definition.scope,
        isRequired: definition.isRequired,
        isFilterable: definition.isFilterable,
        isSearchable: definition.isSearchable,
        allowedValues: definition.allowedValues ? [...definition.allowedValues] : Prisma.DbNull,
        displayOrder,
      };
      await client.attributeDefinition.upsert({
        where: { productTypeId_code: { productTypeId: productType.id, code: definition.code } },
        create: { productTypeId: productType.id, code: definition.code, ...definitionFields },
        update: definitionFields,
      });
    }
  }
  return productTypeIdByCode;
}

async function seedBrands(client: SeedClient): Promise<Map<string, { id: string; name: string }>> {
  const brandBySlug = new Map<string, { id: string; name: string }>();
  for (const brandSeed of brandSeeds) {
    const brand = await client.brand.upsert({
      where: { slug: brandSeed.slug },
      create: { slug: brandSeed.slug, name: brandSeed.name, createdAt: catalogueCreatedAt },
      update: { name: brandSeed.name },
      select: { id: true, name: true },
    });
    brandBySlug.set(brandSeed.slug, brand);
  }
  return brandBySlug;
}

async function seedCategories(client: SeedClient): Promise<Map<string, string>> {
  const categoryBySlug = new Map<string, { id: string; path: string; level: number }>();
  const siblingCountByParent = new Map<string, number>();
  for (const categorySeed of categorySeeds) {
    const parent = categorySeed.parentSlug
      ? requireValue(
          categoryBySlug.get(categorySeed.parentSlug),
          `category ${categorySeed.parentSlug}`,
        )
      : null;
    const parentKey = categorySeed.parentSlug ?? 'root';
    const position = siblingCountByParent.get(parentKey) ?? 0;
    siblingCountByParent.set(parentKey, position + 1);
    const categoryFields = {
      name: categorySeed.name,
      parentId: parent?.id ?? null,
      level: (parent?.level ?? 0) + 1,
      path: `${parent?.path ?? '/'}${categorySeed.slug}/`,
      position,
    };
    const category = await client.category.upsert({
      where: { slug: categorySeed.slug },
      create: { slug: categorySeed.slug, createdAt: catalogueCreatedAt, ...categoryFields },
      update: categoryFields,
      select: { id: true, path: true, level: true },
    });
    categoryBySlug.set(categorySeed.slug, category);
  }
  return new Map([...categoryBySlug].map(([slug, category]) => [slug, category.id]));
}

async function seedProductGroups(client: SeedClient): Promise<Map<string, string>> {
  const groupIdByKey = new Map<string, string>();
  for (const groupSeed of productGroupSeeds) {
    const memberCount = productSeeds.filter(
      (productSeed) => productSeed.group?.groupKey === groupSeed.key,
    ).length;
    const groupId = deterministicUuidV7(`product-group:${groupSeed.key}`, catalogueCreatedAt);
    await client.productGroup.upsert({
      where: { id: groupId },
      create: { id: groupId, name: groupSeed.name, memberCount, createdAt: catalogueCreatedAt },
      update: { name: groupSeed.name, memberCount },
    });
    groupIdByKey.set(groupSeed.key, groupId);
  }
  return groupIdByKey;
}

function cartesianOptionCombinations(
  optionValues: ProductSeed['optionValues'],
): Record<string, string>[] {
  return Object.entries(optionValues).reduce<Record<string, string>[]>(
    (combinations, [optionCode, values]) =>
      combinations.flatMap((combination) =>
        values.map((value) => ({ ...combination, [optionCode]: value })),
      ),
    [{}],
  );
}

function optionSignatureOf(optionValues: Record<string, string>): string {
  return Object.keys(optionValues)
    .sort()
    .map((optionCode) => `${optionCode}=${optionValues[optionCode] ?? ''}`)
    .join('|');
}

function skuSegmentOf(optionValue: string): string {
  return optionValue.replaceAll(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function variantPricePaise(productSeed: ProductSeed, optionValues: Record<string, string>): number {
  const priceSteps = productSeed.optionPriceStepsPaise ?? {};
  return Object.entries(priceSteps).reduce((pricePaise, [optionCode, stepPaise]) => {
    const valueIndex =
      productSeed.optionValues[optionCode]?.indexOf(optionValues[optionCode] ?? '') ?? 0;
    return pricePaise + stepPaise * Math.max(valueIndex, 0);
  }, productSeed.basePricePaise);
}

function mrpForPrice(pricePaise: number, markupPercent: number): number {
  const rupeeInPaise = 100;
  return Math.ceil((pricePaise * (100 + markupPercent)) / 100 / rupeeInPaise) * rupeeInPaise;
}

function productImageUrl(productSlug: string, position: number): string {
  return `https://picsum.photos/seed/${productSlug}-${position}/800/800`;
}

interface ProductSeedContext {
  productTypeIdByCode: Map<string, string>;
  brandBySlug: Map<string, { id: string; name: string }>;
  categoryIdBySlug: Map<string, string>;
  groupIdByKey: Map<string, string>;
}

async function seedProduct(
  client: SeedClient,
  productSeed: ProductSeed,
  productIndex: number,
  context: ProductSeedContext,
): Promise<SeededVariant[]> {
  const productType = requireValue(
    productTypeSeeds.find((typeSeed) => typeSeed.code === productSeed.productTypeCode),
    `product type ${productSeed.productTypeCode}`,
  );
  const brand = requireValue(
    context.brandBySlug.get(productSeed.brandSlug),
    `brand ${productSeed.brandSlug}`,
  );
  const categoryId = productSeed.categorySlug
    ? requireValue(
        context.categoryIdBySlug.get(productSeed.categorySlug),
        `category ${productSeed.categorySlug}`,
      )
    : null;
  const productGroupId = productSeed.group
    ? requireValue(
        context.groupIdByKey.get(productSeed.group.groupKey),
        `group ${productSeed.group.groupKey}`,
      )
    : null;
  const productCreatedAt = daysFromSeedDay(-45 + productIndex);

  const productFields = {
    name: productSeed.name,
    description: productSeed.description,
    status: productSeed.status,
    productTypeId: requireValue(
      context.productTypeIdByCode.get(productSeed.productTypeCode),
      `product type id ${productSeed.productTypeCode}`,
    ),
    brandId: brand.id,
    categoryId,
    taggingStatus: categoryId ? ('TAGGED' as const) : ('UNTAGGED' as const),
    productGroupId,
    groupDisplayOrder: productSeed.group?.displayOrder ?? null,
    groupSwatchLabel: productSeed.group?.swatchLabel ?? null,
    attributes: toJsonValue(productSeed.attributes),
    taxRateBasisPoints: productType.taxRateBasisPoints,
    archivedAt: productSeed.status === 'ARCHIVED' ? daysFromSeedDay(-3) : null,
  };
  const product = await client.product.upsert({
    where: { slug: productSeed.slug },
    create: { slug: productSeed.slug, createdAt: productCreatedAt, ...productFields },
    update: productFields,
    select: { id: true },
  });

  const imagePositions = [0, 1, 2];
  for (const position of imagePositions) {
    const mediaId = deterministicUuidV7(
      `product-media:${productSeed.slug}:${position}`,
      productCreatedAt,
    );
    const mediaFields = {
      url: productImageUrl(productSeed.slug, position),
      altText: `${productSeed.name} image ${position + 1}`,
      position,
    };
    await client.productMedia.upsert({
      where: { id: mediaId },
      create: { id: mediaId, productId: product.id, createdAt: productCreatedAt, ...mediaFields },
      update: mediaFields,
    });
  }

  const dimensions = packageDimensions[productSeed.packageProfile];
  const skuPrefix = `${productSeed.productTypeCode.slice(0, 3).toUpperCase()}${String(productIndex + 1).padStart(3, '0')}`;
  const seededVariants: SeededVariant[] = [];
  for (const optionValues of cartesianOptionCombinations(productSeed.optionValues)) {
    const sku = [skuPrefix, ...Object.values(optionValues).map(skuSegmentOf)].join('-');
    const pricePaise = variantPricePaise(productSeed, optionValues);
    const mrpPaise = mrpForPrice(pricePaise, productSeed.mrpMarkupPercent);
    const variantFields = {
      optionValues,
      optionSignature: optionSignatureOf(optionValues),
      pricePaise,
      mrpPaise,
      ...dimensions,
      status: productSeed.status === 'ARCHIVED' ? ('ARCHIVED' as const) : ('ACTIVE' as const),
    };
    const variant = await client.productVariant.upsert({
      where: { sku },
      create: { sku, productId: product.id, createdAt: productCreatedAt, ...variantFields },
      update: variantFields,
      select: { id: true },
    });
    seededVariants.push({
      id: variant.id,
      sku,
      productId: product.id,
      productSlug: productSeed.slug,
      productName: productSeed.name,
      brandName: brand.name,
      productStatus: productSeed.status,
      optionValues,
      pricePaise,
      mrpPaise,
      taxRateBasisPoints: productType.taxRateBasisPoints,
      imageUrl: productImageUrl(productSeed.slug, 0),
    });
  }
  return seededVariants;
}

async function enqueueSearchSync(client: SeedClient, productIds: string[]): Promise<void> {
  const pendingRows = await client.searchOutbox.findMany({
    where: { entityType: 'product', entityId: { in: productIds }, processedAt: null },
    select: { entityId: true },
  });
  const pendingProductIds = new Set(pendingRows.map((row) => row.entityId));
  await client.searchOutbox.createMany({
    data: productIds
      .filter((productId) => !pendingProductIds.has(productId))
      .map((productId) => ({ entityType: 'product', entityId: productId })),
  });
}

export async function seedCatalogue(client: SeedClient): Promise<SeededCatalogue> {
  const context: ProductSeedContext = {
    productTypeIdByCode: await seedProductTypes(client),
    brandBySlug: await seedBrands(client),
    categoryIdBySlug: await seedCategories(client),
    groupIdByKey: await seedProductGroups(client),
  };

  const variants: SeededVariant[] = [];
  for (const [productIndex, productSeed] of productSeeds.entries()) {
    variants.push(...(await seedProduct(client, productSeed, productIndex, context)));
  }

  const productIdBySlug = new Map(
    variants.map((variant) => [variant.productSlug, variant.productId]),
  );
  await enqueueSearchSync(client, [...new Set(productIdBySlug.values())]);
  return { variants, productIdBySlug };
}
