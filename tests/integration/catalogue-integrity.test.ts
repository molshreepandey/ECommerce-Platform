import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDatabase } from '@/lib/db';
import type * as AuditServiceModule from '@/modules/audit/audit.service';
import type * as SearchOutboxModule from '@/modules/search/search-outbox.repository';
import { DomainError } from '@/lib/errors';
import { staffUserIdSchema } from '@/lib/ids';
import { createBrand, listBrands } from '@/modules/catalogue/brand.service';
import { catalogueConflicts, catalogueUnprocessable } from '@/modules/catalogue/catalogue.errors';
import {
  createBrandSchema,
  createProductSchema,
  createProductTypeSchema,
} from '@/modules/catalogue/catalogue.schema';
import { createProduct, listProducts } from '@/modules/catalogue/product.service';
import { createProductType, listAllProductTypes } from '@/modules/catalogue/product-type.service';
import type { StaffContext } from '@/modules/identity/access-control';
import { isPermissionCode } from '@/modules/identity/permissions';
import { listProductsSchema } from '@/modules/catalogue/catalogue.schema';

import { actorFor, createApparelType, createTestBrand } from './support/catalogue-fixtures';
import { seedDemoIdentity } from './support/identity-fixtures';
import { truncateAllTestTables } from './support/test-database';

const failures = vi.hoisted(() => ({ outbox: false, audit: false }));

vi.mock('@/modules/search/search-outbox.repository', async (importOriginal) => {
  const actual = await importOriginal<typeof SearchOutboxModule>();
  return {
    ...actual,
    enqueueProductReindex: async (...args: Parameters<typeof actual.enqueueProductReindex>) => {
      if (failures.outbox) throw new Error('simulated outbox failure');
      return actual.enqueueProductReindex(...args);
    },
  };
});

vi.mock('@/modules/audit/audit.service', async (importOriginal) => {
  const actual = await importOriginal<typeof AuditServiceModule>();
  return {
    ...actual,
    recordAuditEvent: async (...args: Parameters<typeof actual.recordAuditEvent>) => {
      if (failures.audit) throw new Error('simulated audit failure');
      return actual.recordAuditEvent(...args);
    },
  };
});

const database = getDatabase();

async function staffForRole(roleCode: string): Promise<StaffContext> {
  const permissions = await database.rolePermission.findMany({
    where: { role: { code: roleCode } },
    select: { permission: { select: { code: true } } },
  });
  return {
    staffUserId: staffUserIdSchema.parse(randomUUID()),
    sessionId: randomUUID(),
    permissionCodes: new Set(
      permissions.map(({ permission }) => permission.code).filter(isPermissionCode),
    ),
  };
}

beforeEach(async () => {
  failures.outbox = false;
  failures.audit = false;
  await truncateAllTestTables();
});

describe('permissions for every seeded role (deny by default)', () => {
  it.each([
    ['SUPER_ADMIN', true],
    ['CATALOGUE_MANAGER', true],
    ['INVENTORY_MANAGER', false],
    ['ORDER_OPS', false],
    ['SUPPORT', false],
  ])('%s may change the catalogue: %s; every role may read it', async (roleCode, canWrite) => {
    await seedDemoIdentity();
    const staff = await staffForRole(roleCode);
    expect(staff.permissionCodes.has('catalogue.read')).toBe(true);
    await expect(listAllProductTypes(staff)).resolves.toEqual([]);
    await expect(listBrands(staff)).resolves.toEqual([]);
    await expect(listProducts(staff, listProductsSchema.parse({}))).resolves.toMatchObject({
      totalCount: 0,
    });

    const attempt = createProductType(
      { staff, metadata: actorFor().metadata },
      createProductTypeSchema.parse({ code: `type_${roleCode.toLowerCase()}`, name: 'Type' }),
    );
    if (canWrite) await expect(attempt).resolves.toMatchObject({ name: 'Type' });
    else
      await expect(attempt).rejects.toMatchObject({ code: 'PERMISSION_DENIED', httpStatus: 403 });
  });

  it('refuses a staff member with no permissions at all, even for reads', async () => {
    const nobody: StaffContext = {
      staffUserId: staffUserIdSchema.parse(randomUUID()),
      sessionId: randomUUID(),
      permissionCodes: new Set(),
    };
    await expect(listAllProductTypes(nobody)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(listProducts(nobody, listProductsSchema.parse({}))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });
});

describe('audit and outbox rows share the transaction of the change', () => {
  async function attemptProduct() {
    const productType = await createApparelType();
    const brand = await createTestBrand();
    return createProduct(
      actorFor(),
      createProductSchema.parse({
        productTypeId: productType.id,
        brandId: brand.id,
        name: 'Atomic Kurta',
        attributes: { fabric: 'Cotton' },
        taxRateBasisPoints: 500,
      }),
    );
  }

  it('rolls the product and its audit row back when the outbox write fails', async () => {
    const auditBefore = await database.auditLog.count();
    failures.outbox = true;
    const productTypeAndBrandAudits = 7; // 1 type + 5 attribute definitions + 1 brand, created before the failure
    await expect(attemptProduct()).rejects.toThrow('simulated outbox failure');
    expect(await database.product.count()).toBe(0);
    expect(await database.auditLog.count({ where: { action: 'catalogue.product_created' } })).toBe(
      0,
    );
    expect(await database.auditLog.count()).toBe(auditBefore + productTypeAndBrandAudits);
  });

  it('rolls the product back when its audit row cannot be written', async () => {
    const productType = await createApparelType();
    const brand = await createBrand(actorFor(), createBrandSchema.parse({ name: 'Audit Brand' }));
    failures.audit = true;
    await expect(
      createProduct(
        actorFor(),
        createProductSchema.parse({
          productTypeId: productType.id,
          brandId: brand.id,
          name: 'Unaudited Kurta',
          attributes: { fabric: 'Cotton' },
          taxRateBasisPoints: 500,
        }),
      ),
    ).rejects.toThrow('simulated audit failure');
    expect(await database.product.count()).toBe(0);
    expect(await database.searchOutbox.count()).toBe(0);
  });

  it('records the acting staff member, IP and request id on every catalogue audit row', async () => {
    const actor = actorFor();
    await createProductType(actor, createProductTypeSchema.parse({ code: 'shoes', name: 'Shoes' }));
    await createBrand(actor, createBrandSchema.parse({ name: 'Footloose' }));
    const rows = await database.auditLog.findMany({
      select: { actorType: true, actorId: true, ipAddress: true, requestId: true },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toEqual({
        actorType: 'STAFF',
        actorId: actor.staff.staffUserId,
        ipAddress: '203.0.113.50',
        requestId: actor.metadata.requestId,
      });
    }
  });
});

describe('error responses', () => {
  it('never expose SQL, constraint names or internal ids in catalogue errors', () => {
    const errors: DomainError[] = [
      catalogueConflicts.productTypeCodeTaken(),
      catalogueConflicts.attributeCodeTaken(),
      catalogueConflicts.brandSlugTaken(),
      catalogueConflicts.productSlugTaken(),
      catalogueConflicts.skuTaken('KURTA-M'),
      catalogueConflicts.duplicateVariantCombination('size=M'),
      catalogueConflicts.staleProduct(),
      catalogueConflicts.invalidStatusTransition('ARCHIVED', 'ACTIVE'),
      catalogueConflicts.productArchived(),
      catalogueConflicts.productTypeArchived(),
      catalogueConflicts.productTypeNotArchived(),
      catalogueConflicts.attributeDefinitionArchived(),
      catalogueConflicts.productTypeInUse(3),
      catalogueConflicts.slugLocked(),
      catalogueConflicts.lastActiveVariant(),
      catalogueConflicts.attributeValueInUse(['Cotton']),
      catalogueConflicts.attributeRequiredButMissing(2),
      catalogueConflicts.attributeInUse(4),
      catalogueConflicts.variantArchived(),
      catalogueConflicts.mediaLimitReached(20),
      catalogueConflicts.staleMediaOrder(),
      catalogueUnprocessable.productNotReady(['Add at least one active variant']),
      catalogueUnprocessable.brandInactive(),
      catalogueUnprocessable.variantOptionsOutdated({ 'optionValues.size': ['x'] }),
      catalogueUnprocessable.variantNotInProduct(),
    ];
    expect(errors).toHaveLength(
      Object.keys(catalogueConflicts).length + Object.keys(catalogueUnprocessable).length,
    );
    for (const error of errors) {
      expect(error).toBeInstanceOf(DomainError);
      const envelope = JSON.stringify(error.toEnvelope());
      expect(envelope, error.code).not.toMatch(
        /_key|_fkey|_check|SELECT|INSERT|UPDATE|constraint|prisma/i,
      );
    }
  });
});
