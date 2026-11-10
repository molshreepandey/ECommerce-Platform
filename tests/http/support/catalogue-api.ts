import { expect } from 'vitest';
import { z } from 'zod';

import { demoPassword } from '../../../prisma/seed/demo-credentials';
import { callApi, sessionCookieFrom } from '../app-server';

export const errorEnvelope = z.strictObject({
  error: z.strictObject({ code: z.string(), message: z.string(), details: z.unknown() }),
});

export function errorCode(body: unknown): string {
  return errorEnvelope.parse(body).error.code;
}

export const idSchema = z.object({ id: z.uuid() });

export async function staffCookie(email: string): Promise<string> {
  const response = await callApi('post', 'admin', '/api/admin/auth/login', {
    body: { email, password: demoPassword },
  });
  expect(response.status).toBe(200);
  return sessionCookieFrom(response.headers['set-cookie'], 'admin_session');
}

// Builds catalogue data through the real admin API as the given staff member.
export function catalogueApi(cookie: () => string) {
  async function createType(code: string): Promise<string> {
    const created = await callApi('post', 'admin', '/api/admin/product-types', {
      cookie: cookie(),
      body: { code, name: `Type ${code}` },
    });
    expect(created.status).toBe(201);
    const productTypeId = z.object({ productType: idSchema }).parse(created.body).productType.id;
    for (const definition of [
      {
        code: 'fabric',
        label: 'Fabric',
        dataType: 'ENUM',
        scope: 'PRODUCT',
        isRequired: true,
        allowedValues: ['Cotton', 'Silk'],
      },
      {
        code: 'size',
        label: 'Size',
        dataType: 'ENUM',
        scope: 'VARIANT_OPTION',
        isRequired: true,
        allowedValues: ['S', 'M', 'L'],
      },
    ]) {
      const response = await callApi(
        'post',
        'admin',
        `/api/admin/product-types/${productTypeId}/attribute-definitions`,
        {
          cookie: cookie(),
          body: definition,
        },
      );
      expect(response.status).toBe(201);
    }
    return productTypeId;
  }

  async function createBrand(slug: string): Promise<string> {
    const response = await callApi('post', 'admin', '/api/admin/brands', {
      cookie: cookie(),
      body: { name: `Brand ${slug}`, slug },
    });
    expect(response.status).toBe(201);
    return z.object({ brand: idSchema }).parse(response.body).brand.id;
  }

  async function createProduct(slug: string): Promise<string> {
    const productTypeId = await createType(`type_${slug.replaceAll('-', '_')}`);
    const brandId = await createBrand(`brand-${slug}`);
    const response = await callApi('post', 'admin', '/api/admin/products', {
      cookie: cookie(),
      body: {
        productTypeId,
        brandId,
        name: `Kurta ${slug}`,
        slug,
        attributes: { fabric: 'Cotton' },
        taxRateBasisPoints: 500,
      },
    });
    expect(response.status).toBe(201);
    return z.object({ product: idSchema }).parse(response.body).product.id;
  }

  return { createType, createBrand, createProduct };
}
