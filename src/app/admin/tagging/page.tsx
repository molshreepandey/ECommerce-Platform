import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Link } from '@/components/atoms/Link';
import { Text } from '@/components/atoms/Text';
import { ReadOnlyNotice } from '@/components/organisms/CatalogueAdmin';
import { TaggingQueue } from '@/components/organisms/TaxonomyAdmin';
import { listProductsSchema } from '@/modules/catalogue/catalogue.schema';
import { listProducts } from '@/modules/catalogue/product.service';
import type { StaffContext } from '@/modules/identity/access-control';
import { listCategoryTree } from '@/modules/taxonomy/category.service';
import { categoryNameLabels } from '@/modules/taxonomy/category-tree';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';
import { firstSearchValues } from '../catalogue-page-parts';

export const metadata: Metadata = { title: 'Tagging queue' };

async function Queue({
  staff,
  canWrite,
  searchValues,
}: Readonly<{ staff: StaffContext; canWrite: boolean; searchValues: Record<string, string> }>) {
  const taggingStatus = searchValues['status'] === 'TAGGED' ? 'TAGGED' : 'UNTAGGED';
  const search = searchValues['search'] ?? '';
  const filters = listProductsSchema.safeParse({
    taggingStatus,
    ...(search === '' ? {} : { search }),
    ...(searchValues['cursor'] === undefined ? {} : { cursor: searchValues['cursor'] }),
  });
  const [page, tree] = await Promise.all([
    listProducts(
      staff,
      filters.success ? filters.data : listProductsSchema.parse({ taggingStatus }),
    ),
    listCategoryTree(staff),
  ]);
  const labels = categoryNameLabels(tree);
  const nextQuery =
    page.nextCursor === null
      ? null
      : new URLSearchParams({
          status: taggingStatus,
          ...(search === '' ? {} : { search }),
          cursor: page.nextCursor,
        }).toString();
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <ReadOnlyNotice canWrite={canWrite} />
      <Text variant="body3" tone="muted">
        {page.totalCount} {taggingStatus === 'UNTAGGED' ? 'untagged' : 'tagged'}{' '}
        {page.totalCount === 1 ? 'product' : 'products'}
      </Text>
      <TaggingQueue
        items={page.items.map((item) => ({
          id: item.id,
          name: item.name,
          status: item.status,
          categoryLabel: item.categoryId === null ? null : (labels.get(item.categoryId) ?? null),
        }))}
        leafCategories={tree
          .filter(({ childCount, isActive }) => childCount === 0 && isActive)
          .map(({ id }) => ({ id, label: labels.get(id) ?? id }))
          .sort((left, right) => left.label.localeCompare(right.label))}
        taggingStatus={taggingStatus}
        search={search}
        canWrite={canWrite}
      />
      {nextQuery === null ? null : (
        <Link href={`/tagging?${nextQuery}`} variant="body2-medium">
          Next page
        </Link>
      )}
    </Flexbox>
  );
}

export default function TaggingPage({ searchParams }: PageProps<'/admin/tagging'>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      {searchParams.then((values) => (
        <AdminPageFrame
          path="/tagging"
          title="Tagging queue"
          readPermission="catalogue.read"
          writePermission="taxonomy.write"
        >
          {({ staff, canWrite }) => (
            <Queue staff={staff} canWrite={canWrite} searchValues={firstSearchValues(values)} />
          )}
        </AdminPageFrame>
      ))}
    </Suspense>
  );
}
