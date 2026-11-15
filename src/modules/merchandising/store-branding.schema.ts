import { z } from 'zod';

// D52. The colour is a strict #rrggbb value because it is written into a CSS custom property.
export const storeBrandingSchema = z.strictObject({
  storeName: z.string().trim().min(2).max(60),
  logoUrl: z.url().max(500).nullable(),
  primaryColour: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #4764cd.')
    .transform((value) => value.toLowerCase())
    .nullable(),
});

export type StoreBranding = z.infer<typeof storeBrandingSchema>;

export const defaultStoreBranding: StoreBranding = {
  storeName: 'ShopSphere',
  logoUrl: null,
  primaryColour: null,
};
