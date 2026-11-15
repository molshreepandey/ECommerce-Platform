import { z } from 'zod';

import { apiHandler } from '@/lib/api-handler';
import { getDatabase } from '@/lib/db';
import { checkPincodeServiceability } from '@/modules/fulfilment/courier-serviceability.service';

const querySchema = z.object({
  pincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit pincode.'),
});

export const GET = apiHandler(async (request) => {
  const { pincode } = querySchema.parse({
    pincode: request.nextUrl.searchParams.get('pincode') ?? '',
  });
  return Response.json({
    serviceability: await checkPincodeServiceability(getDatabase(), pincode),
  });
});
