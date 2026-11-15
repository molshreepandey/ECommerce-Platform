import { z } from 'zod';

const optionalDate = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .nullable();

function windowIsOrdered(
  value: { startsAt: Date | null; endsAt: Date | null },
  context: z.RefinementCtx,
) {
  if (value.startsAt !== null && value.endsAt !== null && value.endsAt <= value.startsAt) {
    context.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'The end must be after the start.',
    });
  }
}

// D50: name, slug, active flag and an optional date window; products are set separately.
export const collectionSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(80),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, digits and hyphens.')
      .max(80),
    description: z.string().trim().max(300).default(''),
    isActive: z.boolean(),
    startsAt: optionalDate,
    endsAt: optionalDate,
  })
  .superRefine(windowIsOrdered);

export const collectionProductsSchema = z.strictObject({
  productIds: z
    .array(z.uuid().transform((value) => value.toLowerCase()))
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Each product once.'),
});

// D51: links are paths inside the store ("/collections/festive-edit"), so a banner cannot send customers
// to another site.
export const bannerSchema = z
  .strictObject({
    title: z.string().trim().min(2).max(80),
    imageUrl: z.url().max(500),
    linkUrl: z
      .string()
      .trim()
      .max(300)
      .regex(
        /^\/(?!\/)[A-Za-z0-9\-._~/?=&%]*$/,
        'Use a path inside the store, for example /search?q=kurta.',
      ),
    position: z.int().min(0).max(1000),
    isActive: z.boolean(),
    startsAt: optionalDate,
    endsAt: optionalDate,
  })
  .superRefine(windowIsOrdered);

export type CollectionInput = z.infer<typeof collectionSchema>;
export type BannerInput = z.infer<typeof bannerSchema>;

// Shown only while active and inside its window (an open start or end means no limit on that side).
export function isWithinWindow(
  item: { isActive: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date,
): boolean {
  return (
    item.isActive &&
    (item.startsAt === null || item.startsAt <= now) &&
    (item.endsAt === null || now < item.endsAt)
  );
}
