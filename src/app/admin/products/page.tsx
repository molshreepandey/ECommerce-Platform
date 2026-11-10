import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Flexbox } from '@/components/atoms/Flexbox';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { ProductFilters, ReadOnlyNotice, StatusBadge } from '@/components/organisms/CatalogueAdmin';
import { listBrands } from '@/modules/catalogue/brand.service';
import { listProductsSchema } from '@/modules/catalogue/catalogue.schema';
import { listProducts } from '@/modules/catalogue/product.service';
import { listAllProductTypes } from '@/modules/catalogue/product-type.service';
import type { StaffContext } from '@/modules/identity/access-control';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';
import { firstSearchValues } from '../catalogue-page-parts';

export const metadata: Metadata = { title: 'Products' };

async function ProductList({
  staff,
  canWrite,
  searchValues,
}: Readonly<{ staff: StaffContext; canWrite: boolean; searchValues: Record<string, string> }>) {
  const parsed = listProductsSchema.safeParse(searchValues);
  const filters = parsed.success ? parsed.data : listProductsSchema.parse({});
  const [page, productTypes, brands] = await Promise.all([
    listProducts(staff, filters),
    listAllProductTypes(staff),
    listBrands(staff),
  ]);
  const filterValues = Object.fromEntries(
    Object.entries(parsed.success ? searchValues : {}).filter(([key]) => key !== 'cursor'),
  );
  const nextPageHref =
    page.nextCursor === null
      ? null
      : `/products?${new URLSearchParams({ ...filterValues, cursor: page.nextCursor }).toString()}`;
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <ReadOnlyNotice canWrite={canWrite} />
      {canWrite ? (
        <div>
          <Link href="/products/new" variant="body2-medium">
            New product
          </Link>
        </div>
      ) : null}
      {parsed.success ? null : (
        <InlineAlert tone="warning">
          Some filters in the address were not valid, so all products are shown.
        </InlineAlert>
      )}
      <ProductFilters
        values={parsed.success ? filterValues : {}}
        productTypes={productTypes}
        brands={brands}
      />
      <Text variant="body3" tone="muted">
        {page.totalCount} {page.totalCount === 1 ? 'product' : 'products'}
      </Text>
      {page.items.length === 0 ? (
        <EmptyState
          icon="package"
          headingLevel={2}
          title="No products found"
          description="Change the filters, or add a product."
        />
      ) : (
        <ul aria-label="Products" className="flex flex-col gap-sm">
          {page.items.map((product) => (
            <li
              key={product.id}
              className="flex flex-col gap-xs rounded-default border border-lowlight bg-white p-md md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-xs">
                <Link href={`/products/${product.id}`} variant="body2-medium">
                  {product.name}
                </Link>
                <Text variant="body3" tone="muted">
                  {product.productType.name} · {product.brand.name} · {product._count.variants}{' '}
                  {product._count.variants === 1 ? 'variant' : 'variants'} ·{' '}
                  {product.taggingStatus === 'TAGGED' ? 'tagged' : 'untagged'}
                </Text>
              </div>
              <StatusBadge status={product.status} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-md">
        {filters.cursor === undefined ? null : (
          <Link
            href={`/products?${new URLSearchParams(filterValues).toString()}`}
            variant="body2-medium"
          >
            First page
          </Link>
        )}
        {nextPageHref === null ? null : (
          <Link href={nextPageHref} variant="body2-medium">
            Next page
          </Link>
        )}
      </div>
    </Flexbox>
  );
}

export default function ProductsPage({ searchParams }: PageProps<'/admin/products'>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      {searchParams.then((values) => (
        <AdminPageFrame
          path="/products"
          title="Products"
          readPermission="catalogue.read"
          writePermission="catalogue.write"
        >
          {({ staff, canWrite }) => (
            <ProductList
              staff={staff}
              canWrite={canWrite}
              searchValues={firstSearchValues(values)}
            />
          )}
        </AdminPageFrame>
      ))}
    </Suspense>
  );
}
