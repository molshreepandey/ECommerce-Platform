import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Flexbox } from '@/components/atoms/Flexbox';
import { Heading } from '@/components/atoms/Heading';
import { ReadOnlyNotice } from '@/components/organisms/CatalogueAdmin';
import { ProductGroupEditor } from '@/components/organisms/TaxonomyAdmin';
import { getProductGroup } from '@/modules/grouping/product-group.service';
import type { StaffContext } from '@/modules/identity/access-control';
import { AdminPageFrame, AdminPageLoading } from '../../admin-page-frame';
import { BackLink, CatalogueNotFound, isNotFound, isUuid } from '../../catalogue-page-parts';

export const metadata: Metadata = { title: 'Product group' };

async function loadGroup(staff: StaffContext, groupId: string) {
  if (!isUuid(groupId)) return null;
  try {
    return await getProductGroup(staff, groupId);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function GroupWorkspace({
  staff,
  canWrite,
  groupId,
}: Readonly<{ staff: StaffContext; canWrite: boolean; groupId: string }>) {
  const group = await loadGroup(staff, groupId);
  if (group === null) {
    return (
      <CatalogueNotFound
        what="product group"
        backHref="/product-groups"
        backLabel="All product groups"
      />
    );
  }
  return (
    <Flexbox direction="column" gap="lg" align="stretch">
      <BackLink href="/product-groups" label="All product groups" />
      <Heading level={2} variant="heading3">
        {group.name}
      </Heading>
      <ReadOnlyNotice canWrite={canWrite} />
      <ProductGroupEditor group={group} canWrite={canWrite} />
    </Flexbox>
  );
}

export default function ProductGroupPage({ params }: PageProps<'/admin/product-groups/[groupId]'>) {
  return (
    <Suspense fallback={<AdminPageLoading />}>
      {params.then(({ groupId }) => (
        <AdminPageFrame
          path={`/product-groups/${groupId}`}
          title="Product group"
          readPermission="catalogue.read"
          writePermission="taxonomy.write"
        >
          {({ staff, canWrite }) => (
            <GroupWorkspace staff={staff} canWrite={canWrite} groupId={groupId} />
          )}
        </AdminPageFrame>
      ))}
    </Suspense>
  );
}
