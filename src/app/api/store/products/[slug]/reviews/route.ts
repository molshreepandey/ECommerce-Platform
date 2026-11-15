import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { getProductReviews } from '@/modules/merchandising/review.service';
import { findStorefrontProductId } from '@/modules/catalogue/storefront-product.service';
import { storefrontErrors } from '@/modules/storefront/storefront.errors';

export const GET = apiHandler(
  async (_request, { params }: { params: Promise<{ slug: string }> }) => {
    const slug = z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(120)
      .safeParse((await params).slug);
    const productId = slug.success ? await findStorefrontProductId(slug.data) : null;
    if (productId === null) throw storefrontErrors.productNotFound();
    return Response.json(await getProductReviews(productId));
  },
);
