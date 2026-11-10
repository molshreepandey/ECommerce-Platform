import { getDatabase, isUniqueViolation, uniqueViolationConstraintName } from '@/lib/db';
import { assertStaffPermission, type StaffContext } from '@/modules/identity/access-control';
import { enqueueProductsOfBrand } from '@/modules/search/search-outbox.repository';

import {
  type BrandRow,
  findBrand,
  insertBrand,
  listBrandRows,
  updateBrandRow,
} from './brand.repository';
import { type CatalogueActor, recordCatalogueEvent } from './catalogue-audit';
import {
  CatalogueNotFoundError,
  CatalogueValidationError,
  catalogueConflicts,
} from './catalogue.errors';
import type { CreateBrandInput, UpdateBrandInput } from './catalogue.schema';
import { slugFromName } from './slug';

function rethrowBrandConflict(error: unknown): never {
  if (isUniqueViolation(error) && uniqueViolationConstraintName(error) === 'brands_slug_key') {
    throw catalogueConflicts.brandSlugTaken();
  }
  throw error;
}

function brandAuditData(brand: BrandRow) {
  return { name: brand.name, slug: brand.slug, logoUrl: brand.logoUrl, isActive: brand.isActive };
}

export async function listBrands(staff: StaffContext): Promise<BrandRow[]> {
  assertStaffPermission(staff, 'catalogue.read');
  return await listBrandRows(getDatabase());
}

export async function createBrand(
  actor: CatalogueActor,
  input: CreateBrandInput,
): Promise<BrandRow> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  const slug = input.slug ?? slugFromName(input.name);
  if (slug === '') throw new CatalogueValidationError({ slug: ['Enter a slug'] });
  try {
    return await getDatabase().$transaction(async (transaction) => {
      const brand = await insertBrand(transaction, {
        name: input.name,
        slug,
        logoUrl: input.logoUrl ?? null,
      });
      await recordCatalogueEvent(transaction, actor, {
        action: 'catalogue.brand_created',
        entityType: 'brand',
        entityId: brand.id,
        after: brandAuditData(brand),
      });
      return brand;
    });
  } catch (error) {
    rethrowBrandConflict(error);
  }
}

export async function updateBrand(
  actor: CatalogueActor,
  brandId: string,
  input: UpdateBrandInput,
): Promise<BrandRow> {
  assertStaffPermission(actor.staff, 'catalogue.write');
  try {
    return await getDatabase().$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM brands WHERE id = ${brandId}::uuid FOR UPDATE`;
      const before = await findBrand(transaction, brandId);
      if (before === null) throw new CatalogueNotFoundError('BRAND');
      const after = await updateBrandRow(transaction, brandId, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        ...(input.logoUrl === undefined ? {} : { logoUrl: input.logoUrl }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      });
      await recordCatalogueEvent(transaction, actor, {
        action: 'catalogue.brand_updated',
        entityType: 'brand',
        entityId: brandId,
        before: brandAuditData(before),
        after: brandAuditData(after),
      });
      // The search document carries the brand name and slug, so every product of the brand is reindexed.
      await enqueueProductsOfBrand(transaction, brandId);
      return after;
    });
  } catch (error) {
    rethrowBrandConflict(error);
  }
}
