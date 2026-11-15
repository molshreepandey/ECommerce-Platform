import type { Metadata } from 'next';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { cataloguePhotoCredits } from '@/modules/catalogue/catalogue-art';
import { StorePageFrame } from '../store-page-frame';

export const metadata: Metadata = { title: 'Photo credits' };

// Attribution for the demo catalogue photographs (Wikimedia Commons; CC BY / CC BY-SA require it).
export default function PhotoCreditsPage() {
  return (
    <StorePageFrame>
      <Flexbox direction="column" gap="lg">
        <Flexbox direction="column" gap="xs">
          <Heading level={1} variant="heading2">
            Photo credits
          </Heading>
          <Text variant="body2" tone="subtitle">
            Product photographs in the demo catalogue come from Wikimedia Commons. Each was cropped
            and resized; the authors and licences are listed below.
          </Text>
        </Flexbox>
        {cataloguePhotoCredits.length === 0 ? (
          <Text variant="body2">No third-party photographs are in use.</Text>
        ) : (
          <ul className="grid grid-cols-1 gap-sm md:grid-cols-2">
            {cataloguePhotoCredits.map((credit) => (
              <li key={credit.slug} className="rounded-card border border-lowlight bg-white p-md">
                <Flexbox direction="column" gap="xs">
                  <Link href={credit.sourceUrl} variant="body2-medium" rel="noopener noreferrer">
                    {credit.title.replace(/^File:/, '')}
                  </Link>
                  <Text variant="body3" tone="subtitle">
                    By {credit.author} ·{' '}
                    {credit.licenseUrl === null ? (
                      credit.license
                    ) : (
                      <Link href={credit.licenseUrl} variant="body3" rel="noopener noreferrer">
                        {credit.license}
                      </Link>
                    )}{' '}
                    · {credit.modified}
                  </Text>
                </Flexbox>
              </li>
            ))}
          </ul>
        )}
      </Flexbox>
    </StorePageFrame>
  );
}
