import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { getStorefrontProductPage } from '@/modules/storefront/storefront-product-page.service';
import { storefrontErrors } from '@/modules/storefront/storefront.errors';

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);

export const GET = apiHandler(
  async (_request, { params }: { params: Promise<{ slug: string }> }) => {
    const slug = slugSchema.safeParse((await params).slug);
    if (!slug.success) throw storefrontErrors.productNotFound();
    const page = await getStorefrontProductPage(slug.data);
    return Response.json({
      product: {
        ...page.product,
        variants: page.product.variants.map((variant) => ({
          ...variant,
          availableQuantity: page.availabilityByVariant[variant.id] ?? 0,
        })),
        categoryTrail: page.categoryTrail,
        availableQuantity: page.availableQuantity,
        inStock: page.availableQuantity > 0,
      },
    });
  },
);
