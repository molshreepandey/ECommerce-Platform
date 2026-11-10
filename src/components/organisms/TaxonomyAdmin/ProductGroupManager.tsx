'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Link } from '@/components/atoms/Link';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { ActionFailure, useCatalogueAction } from '@/components/organisms/CatalogueAdmin';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { createProductGroupSchema } from '@/modules/grouping/grouping.schema';

export type ProductGroupItem = Readonly<{ id: string; name: string; memberCount: number }>;

const formId = 'product-group-form';

export function ProductGroupManager({
  groups,
  search,
  canWrite,
}: Readonly<{ groups: readonly ProductGroupItem[]; search: string; canWrite: boolean }>) {
  const router = useRouter();
  const { run, pendingKey, failure, clearFailure } = useCatalogueAction();
  const [isOpen, setIsOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function create(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createProductGroupSchema.safeParse({
      name: formReader(event.currentTarget)('name'),
    });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    const created = z
      .object({ productGroup: z.object({ id: z.uuid() }) })
      .safeParse(
        await run(
          'create',
          { url: '/api/admin/product-groups', method: 'POST', body: parsed.data },
          'Group created',
        ),
      );
    if (created.success) router.push(`/product-groups/${created.data.productGroup.id}`);
  }

  return (
    <div className="flex flex-col gap-lg">
      <form
        role="search"
        aria-label="Group search"
        className="flex flex-col gap-sm md:flex-row md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const text = new FormData(event.currentTarget).get('search');
          const query =
            typeof text === 'string' && text.trim() !== ''
              ? `?search=${encodeURIComponent(text.trim())}`
              : '';
          router.push(`/product-groups${query}`);
        }}
      >
        <FormField label="Search groups" name="search" type="search" defaultValue={search} />
        <Button type="submit" iconBefore="search">
          Search
        </Button>
      </form>
      {canWrite ? (
        <div>
          <Button
            appearance="primary"
            iconBefore="plus"
            onClick={() => {
              clearFailure();
              setFieldErrors({});
              setIsOpen(true);
            }}
          >
            New group
          </Button>
        </div>
      ) : null}
      {groups.length === 0 ? (
        <EmptyState
          icon="boxes"
          headingLevel={2}
          title="No groups found"
          description="A group shows products as options of each other, for example the colours of one kurta."
        />
      ) : (
        <ul aria-label="Product groups" className="grid grid-cols-1 gap-md md:grid-cols-2">
          {groups.map((group) => (
            <li
              key={group.id}
              className="flex items-center justify-between gap-sm rounded-default border border-lowlight bg-white p-md"
            >
              <Link href={`/product-groups/${group.id}`} variant="body2-medium">
                {group.name}
              </Link>
              <Text variant="body3" tone="muted">
                {group.memberCount} of 50 products
              </Text>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={isOpen}
        onOpenChange={setIsOpen}
        title="New group"
        footer={
          <>
            <Button
              onClick={() => {
                setIsOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              appearance="primary"
              isLoading={pendingKey === 'create'}
            >
              Create group
            </Button>
          </>
        }
      >
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-md"
          onSubmit={(event) => void create(event)}
        >
          <ActionFailure failure={failure} />
          <FormField label="Name" name="name" error={fieldErrors['name']} autoComplete="off" />
        </form>
      </Modal>
    </div>
  );
}
