import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Card } from '@/components/atoms/Card';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { MediaManager, ProductEditor, VariantManager } from '@/components/organisms/CatalogueAdmin';
import { listBrands } from '@/modules/catalogue/brand.service';
import { getProduct } from '@/modules/catalogue/product.service';
import { getProductType } from '@/modules/catalogue/product-type.service';
import type { StaffContext } from '@/modules/identity/access-control';
import { AdminPageFrame, AdminPageLoading } from '../../admin-page-frame';
import { BackLink, CatalogueNotFound, isNotFound, isUuid } from '../../catalogue-page-parts';

export const metadata: Metadata = { title: 'Product' };

async function loadProduct(staff: StaffContext, productId: string) {
  try {
    return await getProduct(staff, productId);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function ProductWorkspace({
  staff,
  canWrite,
  productId,
}: Readonly<{ staff: StaffContext; canWrite: boolean; productId: string }>) {
  const product = isUuid(productId) ? await loadProduct(staff, productId) : null;
  if (product === null) {
    return <CatalogueNotFound what="product" backHref="/products" backLabel="All products" />;
  }
  const [productType, brands] = await Promise.all([
    getProductType(staff, product.productTypeId),
    listBrands(staff),
  ]);
  const activeDefinitions = productType.attributeDefinitions.filter(
    ({ archivedAt }) => archivedAt === null,
  );
  const canEdit = canWrite && product.status !== 'ARCHIVED';
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <BackLink href="/products" label="All products" />
      <Heading level={2} variant="heading3">
        {product.name}
      </Heading>
      <ProductEditor
        product={product}
        productAttributes={activeDefinitions.filter(({ scope }) => scope === 'PRODUCT')}
        brands={brands.filter(({ isActive, id }) => isActive || id === product.brandId)}
        canWrite={canWrite}
      />
      <Card as="section">
        <Flexbox direction="column" gap="md" align="stretch">
          <Heading level={2} variant="heading4">
            Variants
          </Heading>
          <VariantManager
            productId={product.id}
            variants={product.variants}
            variantOptions={activeDefinitions.filter(({ scope }) => scope === 'VARIANT_OPTION')}
            canEdit={canEdit}
          />
        </Flexbox>
      </Card>
      <Card as="section">
        <Flexbox direction="column" gap="md" align="stretch">
          <Heading level={2} variant="heading4">
            Images
          </Heading>
          <MediaManager
            productId={product.id}
            media={product.media}
            variants={product.variants.map(({ id, sku }) => ({ id, sku }))}
            canEdit={canEdit}
          />
        </Flexbox>
      </Card>
    </Flexbox>
  );
}

export default function ProductPage({ params }: PageProps<'/admin/products/[productId]'>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      {params.then(({ productId }) => (
        <AdminPageFrame
          path={`/products/${productId}`}
          title="Product"
          readPermission="catalogue.read"
          writePermission="catalogue.write"
        >
          {({ staff, canWrite }) => (
            <ProductWorkspace staff={staff} canWrite={canWrite} productId={productId} />
          )}
        </AdminPageFrame>
      ))}
    </Suspense>
  );
}
