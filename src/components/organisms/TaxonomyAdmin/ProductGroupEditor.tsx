'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Heading } from '@/components/atoms/Heading';
import { Input } from '@/components/atoms/Input';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { FormField } from '@/components/molecules/FormField';
import {
  ActionFailure,
  StatusBadge,
  useCatalogueAction,
} from '@/components/organisms/CatalogueAdmin';
import { sendJson } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';

export type GroupMemberItem = Readonly<{
  id: string;
  name: string;
  status: string;
  groupSwatchLabel: string | null;
}>;
export type ProductGroupView = Readonly<{
  id: string;
  name: string;
  memberCount: number;
  members: readonly GroupMemberItem[];
}>;

const searchResultsSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      status: z.string(),
      productGroupId: z.string().nullable(),
    }),
  ),
});
type SearchResult = z.infer<typeof searchResultsSchema>['items'][number];

function MemberOrderEditor({
  group,
  canWrite,
}: Readonly<{ group: ProductGroupView; canWrite: boolean }>) {
  const { run, pendingKey, failure } = useCatalogueAction();
  const [members, setMembers] = useState(
    group.members.map((member) => ({ ...member, swatch: member.groupSwatchLabel ?? '' })),
  );
  const [toRemove, setToRemove] = useState<GroupMemberItem | null>(null);

  function moveMember(index: number, offset: -1 | 1) {
    const next = [...members];
    const current = next[index];
    const neighbour = next[index + offset];
    if (current === undefined || neighbour === undefined) return;
    next[index] = neighbour;
    next[index + offset] = current;
    setMembers(next);
  }

  if (members.length === 0) {
    return (
      <EmptyState
        icon="boxes"
        headingLevel={2}
        title="No products in this group"
        description="Search for products below and add them."
      />
    );
  }
  return (
    <div className="flex flex-col gap-md">
      <ActionFailure failure={failure} />
      <ol aria-label="Group members" className="flex flex-col gap-sm">
        {members.map((member, index) => (
          <li
            key={member.id}
            className="flex flex-col gap-sm rounded-default border border-lowlight bg-white p-md md:flex-row md:items-center md:justify-between"
          >
            <div className="flex flex-wrap items-center gap-sm">
              <Text variant="body2-medium">
                {index + 1}. {member.name}
              </Text>
              <StatusBadge status={member.status} />
            </div>
            {canWrite ? (
              <div className="flex flex-wrap items-center gap-xs">
                <div className="w-40">
                  <Input
                    aria-label={`Swatch label for ${member.name}`}
                    value={member.swatch}
                    maxLength={40}
                    placeholder="Swatch label"
                    onChange={(event) => {
                      setMembers(
                        members.map((item) =>
                          item.id === member.id ? { ...item, swatch: event.target.value } : item,
                        ),
                      );
                    }}
                  />
                </div>
                <Button
                  size="sm"
                  iconBefore="arrow-up"
                  disabled={index === 0}
                  onClick={() => {
                    moveMember(index, -1);
                  }}
                >
                  Move {member.name} up
                </Button>
                <Button
                  size="sm"
                  iconBefore="arrow-down"
                  disabled={index === members.length - 1}
                  onClick={() => {
                    moveMember(index, 1);
                  }}
                >
                  Move {member.name} down
                </Button>
                <Button
                  size="sm"
                  appearance="subtle"
                  iconBefore="trash"
                  onClick={() => {
                    setToRemove(member);
                  }}
                >
                  Remove {member.name}
                </Button>
              </div>
            ) : (
              <Text variant="body3" tone="muted">
                {member.groupSwatchLabel ?? 'No swatch label'}
              </Text>
            )}
          </li>
        ))}
      </ol>
      {canWrite ? (
        <div>
          <Button
            appearance="primary"
            isLoading={pendingKey === 'order'}
            onClick={() =>
              void run(
                'order',
                {
                  url: `/api/admin/product-groups/${group.id}/members`,
                  method: 'PUT',
                  body: {
                    members: members.map(({ id, swatch }) => ({
                      productId: id,
                      swatchLabel: swatch.trim() === '' ? null : swatch.trim(),
                    })),
                  },
                },
                'Order and swatch labels saved',
              )
            }
          >
            Save order and swatch labels
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setToRemove(null);
        }}
        title={`Remove ${toRemove?.name ?? 'product'} from the group?`}
        description="The product itself is not changed or deleted."
        confirmLabel="Remove from group"
        isPending={pendingKey === 'remove'}
        onConfirm={() => {
          if (toRemove === null) return;
          void run(
            'remove',
            {
              url: `/api/admin/product-groups/${group.id}/members/${toRemove.id}`,
              method: 'DELETE',
            },
            'Product removed from the group',
          ).then(() => {
            setToRemove(null);
          });
        }}
      />
    </div>
  );
}

function AddMembers({ group }: Readonly<{ group: ProductGroupView }>) {
  const { run, pendingKey, failure } = useCatalogueAction();
  const [results, setResults] = useState<readonly SearchResult[] | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [searchFailed, setSearchFailed] = useState(false);

  async function search(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = formReader(event.currentTarget)('search').trim();
    if (text === '') return;
    const response = await sendJson(
      `/api/admin/products?search=${encodeURIComponent(text)}&limit=20`,
      { method: 'GET' },
    );
    const parsed = response.ok ? searchResultsSchema.safeParse(response.data) : null;
    setSearchFailed(parsed === null || !parsed.success);
    setResults(parsed?.success === true ? parsed.data.items : []);
    setChosen(new Set());
  }

  return (
    <div className="flex flex-col gap-md">
      <form
        role="search"
        aria-label="Product search"
        className="flex flex-col gap-sm md:flex-row md:items-end"
        onSubmit={(event) => void search(event)}
      >
        <FormField label="Find products to add" name="search" type="search" />
        <Button type="submit" iconBefore="search">
          Find
        </Button>
      </form>
      <ActionFailure failure={failure} />
      {searchFailed ? <Text tone="danger">The search failed. Please try again.</Text> : null}
      {results === null ? null : results.length === 0 ? (
        <Text tone="muted">No products match.</Text>
      ) : (
        <>
          <ul aria-label="Products found" className="flex flex-col gap-xs">
            {results.map((product) => {
              const isElsewhere = product.productGroupId !== null;
              return (
                <li key={product.id}>
                  <Checkbox
                    label={isElsewhere ? `${product.name} (already in a group)` : product.name}
                    disabled={isElsewhere || product.status === 'ARCHIVED'}
                    checked={chosen.has(product.id)}
                    onCheckedChange={(checked) => {
                      const next = new Set(chosen);
                      if (checked === true) next.add(product.id);
                      else next.delete(product.id);
                      setChosen(next);
                    }}
                  />
                </li>
              );
            })}
          </ul>
          <div>
            <Button
              appearance="primary"
              disabled={chosen.size === 0}
              isLoading={pendingKey === 'add'}
              onClick={() =>
                void run(
                  'add',
                  {
                    url: `/api/admin/product-groups/${group.id}/members`,
                    method: 'POST',
                    body: { productIds: [...chosen] },
                  },
                  'Products added to the group',
                ).then((done) => {
                  if (done !== null) {
                    setResults(null);
                    setChosen(new Set());
                  }
                })
              }
            >
              Add selected ({chosen.size})
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function ProductGroupEditor({
  group,
  canWrite,
}: Readonly<{ group: ProductGroupView; canWrite: boolean }>) {
  const router = useRouter();
  const { run, pendingKey, failure } = useCatalogueAction();
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const membershipKey = group.members.map(({ id }) => id).join(',');

  return (
    <div className="flex flex-col gap-lg">
      <Text variant="body3" tone="muted">
        {group.memberCount} of 50 products
      </Text>
      {renaming ? null : <ActionFailure failure={failure} />}
      {canWrite ? (
        <div className="flex flex-wrap gap-sm">
          <Button
            iconBefore="pencil"
            onClick={() => {
              setRenaming(true);
            }}
          >
            Rename group
          </Button>
          <Button
            appearance="subtle"
            iconBefore="trash"
            onClick={() => {
              setConfirmDelete(true);
            }}
          >
            Delete group
          </Button>
        </div>
      ) : null}
      <section aria-labelledby="members-heading" className="flex flex-col gap-md">
        <Heading level={2} variant="heading4" id="members-heading">
          Products in this group
        </Heading>
        {/* Remounts only when membership changes, so unsaved order and swatch edits survive other refreshes. */}
        <MemberOrderEditor key={membershipKey} group={group} canWrite={canWrite} />
      </section>
      {canWrite ? (
        <section aria-labelledby="add-heading" className="flex flex-col gap-md">
          <Heading level={2} variant="heading4" id="add-heading">
            Add products
          </Heading>
          <AddMembers group={group} />
        </section>
      ) : null}
      <Modal
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename group"
        footer={
          <>
            <Button
              onClick={() => {
                setRenaming(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="rename-group"
              appearance="primary"
              isLoading={pendingKey === 'rename'}
            >
              Save
            </Button>
          </>
        }
      >
        <form
          id="rename-group"
          noValidate
          className="flex flex-col gap-md"
          onSubmit={(event) => {
            event.preventDefault();
            const name = formReader(event.currentTarget)('name');
            void run(
              'rename',
              { url: `/api/admin/product-groups/${group.id}`, method: 'PATCH', body: { name } },
              'Group renamed',
            ).then((done) => {
              if (done !== null) setRenaming(false);
            });
          }}
        >
          <ActionFailure failure={failure} />
          <FormField
            label="Name"
            name="name"
            defaultValue={group.name}
            error={failure?.fieldErrors['name']}
          />
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${group.name}?`}
        description="Its products stay in the catalogue; they are only taken out of the group."
        confirmLabel="Delete group"
        isPending={pendingKey === 'delete'}
        onConfirm={() => {
          void run(
            'delete',
            { url: `/api/admin/product-groups/${group.id}`, method: 'DELETE' },
            'Group deleted',
          ).then((done) => {
            if (done !== null) router.push('/product-groups');
          });
        }}
      />
    </div>
  );
}
