import Image from 'next/image';
import NextLink from 'next/link';
import { Text } from '@/components/atoms/Text';
import { focusRingClassNames } from '@/components/atoms/focus-ring';
import { displayImageUrl } from '@/modules/catalogue/catalogue-art';

export type HomeBanner = Readonly<{ id: string; title: string; imageUrl: string; linkUrl: string }>;

// C6 / D51: banners in their admin order; only those active and inside their window reach this list.
export function HomeBanners({ banners }: Readonly<{ banners: readonly HomeBanner[] }>) {
  if (banners.length === 0) return null;
  return (
    <section aria-label="Offers">
      <ul className="grid grid-cols-1 gap-md md:grid-cols-2">
        {banners.map((banner) => (
          <li key={banner.id}>
            <NextLink
              href={banner.linkUrl}
              className={`group relative block aspect-[16/7] overflow-hidden rounded-card bg-strokes ${focusRingClassNames}`}
            >
              <Image
                src={displayImageUrl(banner.imageUrl)}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="object-cover transition-transform group-hover:scale-105"
                unoptimized
              />
              <span className="absolute inset-x-0 bottom-0 bg-headings/70 px-lg py-md">
                <Text as="span" variant="body1-medium" tone="inverse">
                  {banner.title}
                </Text>
              </span>
            </NextLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
