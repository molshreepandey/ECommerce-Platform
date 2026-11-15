import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Breadcrumb } from '@/components/atoms/Breadcrumb';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { SearchResultsGrid } from '@/components/organisms/StorefrontCatalogue';
import { isNotFoundError } from '@/lib/errors';
import { loadStorefrontCollection } from '@/modules/merchandising/merchandising.service';
import { StorePageFrame } from '../../store-page-frame';

export const instant = false;

type PageProps = Readonly<{ params: Promise<{ slug: string }> }>;

// The active-dates window is checked against the request time, so this page renders per request.
async function loadCollection(slug: string) {
  await connection();
  try {
    return await loadStorefrontCollection(slug);
  } catch (error) {
    if (isNotFoundError(error)) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  return { title: (await loadCollection((await params).slug)).name };
}

// C13: a hand-picked collection; unknown, inactive or out-of-window collections are 404 (proxy check).
export default async function CollectionPage({ params }: PageProps) {
  const collection = await loadCollection((await params).slug);
  return (
    <StorePageFrame>
      <Flexbox direction="column" gap="lg">
        <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: collection.name }]} />
        <Flexbox direction="column" gap="xs">
          <Heading level={1} variant="heading2">
            {collection.name}
          </Heading>
          {collection.description === '' ? null : (
            <Text tone="subtitle">{collection.description}</Text>
          )}
        </Flexbox>
        <SearchResultsGrid
          products={collection.products}
          emptyAction={<Link href="/search">Browse all products</Link>}
        />
      </Flexbox>
    </StorePageFrame>
  );
}
