import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/atoms/Breadcrumb';
import { Flexbox } from '@/components/atoms/Flexbox';
import { ProductReviews } from '@/components/organisms/Reviews';
import { ProductDetail } from '@/components/organisms/StorefrontCatalogue';
import { isNotFoundError } from '@/lib/errors';
import { getProductReviews } from '@/modules/merchandising/review.service';
import { getStorefrontProductPage } from '@/modules/storefront/storefront-product-page.service';
import { StorePageFrame } from '../../store-page-frame';

// Blocks until the product is loaded, so an unknown slug answers with a real 404 rather than a streamed one.
export const instant = false;

type ProductPageProps = Readonly<{ params: Promise<{ slug: string }> }>;

async function loadProductPage(slug: string) {
  try {
    return await getStorefrontProductPage(slug);
  } catch (error) {
    if (isNotFoundError(error)) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const page = await loadProductPage((await params).slug);
  return { title: page.product.name, description: page.product.description.slice(0, 160) };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const page = await loadProductPage((await params).slug);
  return (
    <StorePageFrame>
      <Flexbox direction="column" gap="lg">
        <Breadcrumb
          items={[
            { label: 'Home', href: '/' },
            ...page.categoryTrail.map((category) => ({
              label: category.name,
              href: `/categories/${category.slug}`,
            })),
            { label: page.product.name },
          ]}
        />
        <ProductDetail product={page.product} availabilityByVariant={page.availabilityByVariant} />
        <ProductReviews list={await getProductReviews(page.product.id)} />
      </Flexbox>
    </StorePageFrame>
  );
}
