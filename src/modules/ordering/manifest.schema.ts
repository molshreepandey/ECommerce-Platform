import { z } from 'zod';

export const manifestQuerySchema = z.object({
  warehouseId: z.uuid().transform((value) => value.toLowerCase()),
  date: z.iso.date(),
});
