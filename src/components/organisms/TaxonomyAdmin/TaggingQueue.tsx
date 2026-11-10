'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import {
  ActionFailure,
  StatusBadge,
  useCatalogueAction,
} from '@/components/organisms/CatalogueAdmin';

export type TaggingQueueItem = Readonly<{
  id: string;
  name: string;
  status: string;
  categoryLabel: string | null;
}>;
export type LeafCategoryChoice = Readonly<{ id: string; label: string }>;

export function TaggingQueue({
  items,
  leafCategories,
  taggingStatus,
  search,
  canWrite,
}: Readonly<{
  items: readonly TaggingQueueItem[];
  leafCategories: readonly LeafCategoryChoice[];
  taggingStatus: 'UNTAGGED' | 'TAGGED';
  search: string;
  canWrite: boolean;
}>) {
  const router = useRouter();
  const { run, pendingKey, failure } = useCatalogueAction();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState(taggingStatus);

  function applyFilters(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const searchText = new FormData(event.currentTarget).get('search');
    const query = new URLSearchParams({ status });
    if (typeof searchText === 'string' && searchText.trim() !== '')
      query.set('search', searchText.trim());
    setSelected(new Set());
    router.push(`/tagging?${query.toString()}`);
  }

  async function changeSelected(target: string | null, message: string) {
    const done = await run(
      target === null ? 'untag' : 'tag',
      {
        url: '/api/admin/tagging',
        method: 'POST',
        body: { productIds: [...selected], categoryId: target },
      },
      message,
    );
    if (done !== null) setSelected(new Set());
  }

  const allSelected = items.length > 0 && items.every(({ id }) => selected.has(id));
  return (
    <div className="flex flex-col gap-lg">
      <form
        role="search"
        aria-label="Filter the tagging queue"
        noValidate
        className="grid grid-cols-1 gap-md rounded-default border border-lowlight bg-white p-md md:grid-cols-3"
        onSubmit={applyFilters}
      >
        <SelectField
          label="Show"
          name="status"
          options={[
            { value: 'UNTAGGED', label: 'Untagged products' },
            { value: 'TAGGED', label: 'Tagged products' },
          ]}
          value={status}
          onValueChange={(value) => {
            setStatus(value === 'TAGGED' ? 'TAGGED' : 'UNTAGGED');
          }}
        />
        <FormField label="Search by name" name="search" type="search" defaultValue={search} />
        <div className="flex items-end">
          <Button type="submit" appearance="primary" iconBefore="search">
            Show products
          </Button>
        </div>
      </form>
      <ActionFailure failure={failure} />
      {canWrite && items.length > 0 ? (
        <div className="flex flex-col gap-md rounded-default border border-lowlight bg-white p-md md:flex-row md:items-end">
          <div className="md:w-96">
            <SelectField
              label="Category for the selected products"
              name="categoryId"
              options={leafCategories.map(({ id, label }) => ({ value: id, label }))}
              value={categoryId}
              placeholder={
                leafCategories.length === 0 ? 'No active leaf categories' : 'Choose a category'
              }
              onValueChange={setCategoryId}
            />
          </div>
          <div className="flex flex-wrap gap-sm">
            <Button
              appearance="primary"
              disabled={selected.size === 0 || categoryId === ''}
              isLoading={pendingKey === 'tag'}
              onClick={() => void changeSelected(categoryId, 'Products tagged')}
            >
              Tag selected ({selected.size})
            </Button>
            {taggingStatus === 'TAGGED' ? (
              <Button
                disabled={selected.size === 0}
                isLoading={pendingKey === 'untag'}
                onClick={() => void changeSelected(null, 'Products untagged')}
              >
                Untag selected
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          icon="list-checks"
          headingLevel={2}
          title={
            taggingStatus === 'UNTAGGED' ? 'Every product is tagged' : 'No tagged products found'
          }
          description="Change the filters to see other products."
        />
      ) : (
        <>
          {canWrite ? (
            <Checkbox
              label="Select all on this page"
              checked={allSelected}
              onCheckedChange={(checked) => {
                setSelected(checked === true ? new Set(items.map(({ id }) => id)) : new Set());
              }}
            />
          ) : null}
          <ul aria-label="Products to tag" className="flex flex-col gap-sm">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-xs rounded-default border border-lowlight bg-white p-md md:flex-row md:items-center md:justify-between"
              >
                <div className="flex flex-col gap-xs">
                  {canWrite ? (
                    <Checkbox
                      label={item.name}
                      checked={selected.has(item.id)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selected);
                        if (checked === true) next.add(item.id);
                        else next.delete(item.id);
                        setSelected(next);
                      }}
                    />
                  ) : (
                    <Text variant="body2-medium">{item.name}</Text>
                  )}
                  <Text variant="body3" tone="muted">
                    {item.categoryLabel ?? 'Not tagged yet'}
                  </Text>
                </div>
                <StatusBadge status={item.status} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
