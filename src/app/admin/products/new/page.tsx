import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Flexbox } from '@/components/atoms/Flexbox';
import { ProductCreateForm } from '@/components/organisms/CatalogueAdmin';
import { listBrands } from '@/modules/catalogue/brand.service';
import { listProductTypesWithDefinitions } from '@/modules/catalogue/product-type.service';
import { AdminPageFrame, AdminPageLoading } from '../../admin-page-frame';
import { BackLink } from '../../catalogue-page-parts';

export const metadata: Metadata = { title: 'New product' };

export default function NewProductPage() {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/products/new"
        title="New product"
        readPermission="catalogue.write"
        writePermission="catalogue.write"
      >
        {async ({ staff }) => {
          const [productTypes, brands] = await Promise.all([
            listProductTypesWithDefinitions(staff),
            listBrands(staff),
          ]);
          return (
            <Flexbox direction="column" gap="lg" align="stretch">
              <BackLink href="/products" label="All products" />
              <ProductCreateForm
                productTypes={productTypes.map((productType) => ({
                  id: productType.id,
                  name: productType.name,
                  productAttributes: productType.attributeDefinitions.filter(
                    ({ scope }) => scope === 'PRODUCT',
                  ),
                }))}
                brands={brands.filter(({ isActive }) => isActive)}
              />
            </Flexbox>
          );
        }}
      </AdminPageFrame>
    </Suspense>
  );
}
