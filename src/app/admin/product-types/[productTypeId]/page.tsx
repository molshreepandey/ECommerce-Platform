import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Flexbox } from '@/components/atoms/Flexbox';
import { AttributeDefinitionManager } from '@/components/organisms/CatalogueAdmin';
import type { StaffContext } from '@/modules/identity/access-control';
import { getProductType } from '@/modules/catalogue/product-type.service';
import { AdminPageFrame, AdminPageLoading } from '../../admin-page-frame';
import { BackLink, CatalogueNotFound, isNotFound, isUuid } from '../../catalogue-page-parts';

export const metadata: Metadata = { title: 'Product type' };

async function loadProductType(staff: StaffContext, productTypeId: string) {
  if (!isUuid(productTypeId)) return null;
  try {
    return await getProductType(staff, productTypeId);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function ProductTypeDetail({
  staff,
  canWrite,
  productTypeId,
}: Readonly<{ staff: StaffContext; canWrite: boolean; productTypeId: string }>) {
  const productType = await loadProductType(staff, productTypeId);
  if (productType === null) {
    return (
      <CatalogueNotFound
        what="product type"
        backHref="/product-types"
        backLabel="All product types"
      />
    );
  }
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <BackLink href="/product-types" label="All product types" />
      <AttributeDefinitionManager
        productType={productType}
        definitions={productType.attributeDefinitions}
        canWrite={canWrite}
      />
    </Flexbox>
  );
}

export default function ProductTypePage({
  params,
}: PageProps<'/admin/product-types/[productTypeId]'>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      {params.then(({ productTypeId }) => (
        <AdminPageFrame
          path={`/product-types/${productTypeId}`}
          title="Product type"
          readPermission="catalogue.read"
          writePermission="catalogue.write"
        >
          {({ staff, canWrite }) => (
            <ProductTypeDetail staff={staff} canWrite={canWrite} productTypeId={productTypeId} />
          )}
        </AdminPageFrame>
      ))}
    </Suspense>
  );
}
