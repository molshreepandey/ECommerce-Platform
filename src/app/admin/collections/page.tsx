import type { Metadata } from 'next';
import { Suspense } from 'react';
import { z } from 'zod';
import { CollectionManager } from '@/components/organisms/Merchandising';
import type { StaffContext } from '@/modules/identity/access-control';
import { getCollection, listCollections } from '@/modules/merchandising/merchandising.service';
import { AdminPageFrame, AdminPageLoading } from '../admin-page-frame';
import { firstSearchValues } from '../catalogue-page-parts';

export const metadata: Metadata = { title: 'Collections' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

async function Collections({
  staff,
  canWrite,
  searchParams,
}: Readonly<{ staff: StaffContext; canWrite: boolean; searchParams: SearchParams }>) {
  const selectedId = z.uuid().safeParse(firstSearchValues(await searchParams)['collection']);
  const [collections, selected] = await Promise.all([
    listCollections(staff),
    selectedId.success
      ? getCollection(staff, selectedId.data.toLowerCase()).catch(() => null)
      : Promise.resolve(null),
  ]);
  const items = collections.map((collection) => ({
    id: collection.id,
    name: collection.name,
    slug: collection.slug,
    description: collection.description,
    isActive: collection.isActive,
    startsAt: iso(collection.startsAt),
    endsAt: iso(collection.endsAt),
    productCount: collection._count.products,
  }));
  const selectedItem =
    selected === null ? null : (items.find(({ id }) => id === selected.id) ?? null);
  return (
    <CollectionManager
      key={selectedItem?.id ?? 'none'}
      canWrite={canWrite}
      collections={items}
      selected={
        selected === null || selectedItem === null
          ? null
          : {
              collection: selectedItem,
              products: selected.products.map((entry) => ({
                productId: entry.productId,
                name: entry.product.name,
                status: entry.product.status,
              })),
            }
      }
    />
  );
}

export default function CollectionsPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      <AdminPageFrame
        path="/collections"
        title="Collections"
        readPermission="catalogue.read"
        writePermission="merchandising.write"
      >
        {({ staff, canWrite }) => (
          <Collections staff={staff} canWrite={canWrite} searchParams={searchParams} />
        )}
      </AdminPageFrame>
    </Suspense>
  );
}
