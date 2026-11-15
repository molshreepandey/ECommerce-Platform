import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { DomainError } from '@/lib/errors';
import { loadStorefrontCollection } from '@/modules/merchandising/merchandising.service';

export const GET = apiHandler(
  async (_request, { params }: { params: Promise<{ slug: string }> }) => {
    const slug = z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80)
      .safeParse((await params).slug);
    if (!slug.success) {
      throw new DomainError({
        kind: 'NOT_FOUND',
        code: 'COLLECTION_NOT_FOUND',
        message: 'This collection was not found.',
      });
    }
    return Response.json({ collection: await loadStorefrontCollection(slug.data) });
  },
);
