'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { EmptyState } from '@/components/atoms/EmptyState';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Link } from '@/components/atoms/Link';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { type FieldErrors, firstMessages, sendJson } from '@/lib/api-client';
import { fromLocalInput, toLocalInput } from '@/lib/date-input';
import { formReader } from '@/lib/form-values';
import { collectionSchema } from '@/modules/merchandising/merchandising.schema';
import { useAdminAction } from '../AdminActions/use-admin-action';

export type CollectionItem = Readonly<{
  id: string;
  name: string;
  slug: string;
  description: string;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  productCount: number;
}>;

export type CollectionProductItem = Readonly<{ productId: string; name: string; status: string }>;

const searchResultSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
});
const formId = 'collection-form';

function windowText(item: CollectionItem): string {
  const from =
    item.startsAt === null ? 'any time' : new Date(item.startsAt).toLocaleDateString('en-IN');
  const until = item.endsAt === null ? 'no end' : new Date(item.endsAt).toLocaleDateString('en-IN');
  return `${from} – ${until}`;
}

// D50: collections with a date window and a hand-picked, ordered product list.
export function CollectionManager({
  collections,
  selected,
  canWrite,
}: Readonly<{
  collections: readonly CollectionItem[];
  selected: { collection: CollectionItem; products: readonly CollectionProductItem[] } | null;
  canWrite: boolean;
}>) {
  const { run, isPending, failure, clearFailure } = useAdminAction();
  const [editing, setEditing] = useState<CollectionItem | 'new' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [products, setProducts] = useState<CollectionProductItem[]>(() => [
    ...(selected?.products ?? []),
  ]);
  const [results, setResults] = useState<CollectionProductItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = formReader(event.currentTarget);
    const parsed = collectionSchema.safeParse({
      name: text('name'),
      slug: text('slug'),
      description: text('description'),
      isActive: text('isActive') === 'on',
      startsAt: fromLocalInput(text('startsAt')),
      endsAt: fromLocalInput(text('endsAt')),
    });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    const body = {
      ...parsed.data,
      startsAt: parsed.data.startsAt?.toISOString() ?? null,
      endsAt: parsed.data.endsAt?.toISOString() ?? null,
    };
    const saved = await run(
      editing === 'new' || editing === null
        ? { url: '/api/admin/collections', method: 'POST', body }
        : { url: `/api/admin/collections/${editing.id}`, method: 'PUT', body },
      editing === 'new' ? 'Collection created' : 'Collection saved',
    );
    if (saved !== null) setEditing(null);
  }

  async function searchProducts(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = formReader(event.currentTarget)('search').trim();
    if (term === '') return;
    const response = await sendJson(
      `/api/admin/products?search=${encodeURIComponent(term)}&limit=10`,
      {
        method: 'GET',
      },
    );
    if (!response.ok) {
      setSearchError(response.failure.message);
      return;
    }
    const parsed = searchResultSchema.safeParse(response.data);
    setSearchError(null);
    setResults(
      parsed.success
        ? parsed.data.items.map((item) => ({
            productId: item.id,
            name: item.name,
            status: item.status,
          }))
        : [],
    );
  }

  function move(index: number, offset: number) {
    setProducts((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item !== undefined) next.splice(index + offset, 0, item);
      return next;
    });
  }

  const current = editing === 'new' ? null : editing;
  return (
    <div className="flex flex-col gap-lg">
      {editing === null && failure !== null ? (
        <InlineAlert tone="danger">{failure.message}</InlineAlert>
      ) : null}
      {canWrite ? (
        <div>
          <Button
            appearance="primary"
            iconBefore="plus"
            onClick={() => {
              clearFailure();
              setFieldErrors({});
              setEditing('new');
            }}
          >
            New collection
          </Button>
        </div>
      ) : null}
      {collections.length === 0 ? (
        <EmptyState icon="layers" headingLevel={2} title="No collections yet" />
      ) : (
        <ul aria-label="Collections" className="grid grid-cols-1 gap-md lg:grid-cols-2">
          {collections.map((item) => (
            <li
              key={item.id}
              aria-label={item.name}
              className="flex flex-col gap-sm rounded-default border border-lowlight bg-white p-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-sm">
                <div className="flex flex-col gap-xs">
                  <Text variant="body2-medium">{item.name}</Text>
                  <Text variant="body3" tone="muted">
                    /collections/{item.slug} · {item.productCount} products · {windowText(item)}
                  </Text>
                </div>
                <Badge tone={item.isActive ? 'success' : 'neutral'}>
                  {item.isActive ? 'active' : 'inactive'}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-sm">
                <Link href={`/collections?collection=${item.id}`} variant="body2">
                  Products
                </Link>
                {canWrite ? (
                  <Button
                    size="sm"
                    iconBefore="pencil"
                    aria-label={`Edit ${item.name}`}
                    onClick={() => {
                      clearFailure();
                      setFieldErrors({});
                      setEditing(item);
                    }}
                  >
                    Edit
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {selected === null ? null : (
        <section
          aria-labelledby="collection-products"
          className="flex flex-col gap-md rounded-default border border-lowlight bg-white p-md"
        >
          <Text as="span" variant="body1-medium" id="collection-products">
            Products in {selected.collection.name}
          </Text>
          {products.length === 0 ? <Text tone="muted">No products yet.</Text> : null}
          <ol className="flex flex-col gap-xs">
            {products.map((product, index) => (
              <li
                key={product.productId}
                className="flex flex-wrap items-center justify-between gap-sm border-b border-strokes py-xs last:border-b-0"
              >
                <Text variant="body2">
                  {index + 1}. {product.name}{' '}
                  {product.status === 'ACTIVE' ? '' : `(${product.status.toLowerCase()}, hidden)`}
                </Text>
                {canWrite ? (
                  <span className="flex gap-xs">
                    <Button
                      size="xs"
                      iconBefore="arrow-up"
                      aria-label={`Move ${product.name} up`}
                      disabled={index === 0}
                      onClick={() => {
                        move(index, -1);
                      }}
                    />
                    <Button
                      size="xs"
                      iconBefore="arrow-down"
                      aria-label={`Move ${product.name} down`}
                      disabled={index === products.length - 1}
                      onClick={() => {
                        move(index, 1);
                      }}
                    />
                    <Button
                      size="xs"
                      appearance="ghost"
                      iconBefore="trash"
                      aria-label={`Remove ${product.name}`}
                      onClick={() => {
                        setProducts((items) =>
                          items.filter((item) => item.productId !== product.productId),
                        );
                      }}
                    />
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          {canWrite ? (
            <>
              <form
                noValidate
                aria-label="Find products"
                onSubmit={(event) => void searchProducts(event)}
                className="flex items-end gap-sm"
              >
                <div className="flex-1">
                  <FormField
                    label="Find a product to add"
                    name="search"
                    error={searchError ?? undefined}
                  />
                </div>
                <Button type="submit" iconBefore="search">
                  Find
                </Button>
              </form>
              <ul className="flex flex-col gap-xs">
                {results
                  .filter(
                    (result) => !products.some((product) => product.productId === result.productId),
                  )
                  .map((result) => (
                    <li key={result.productId} className="flex items-center justify-between gap-sm">
                      <Text variant="body3">
                        {result.name} · {result.status.toLowerCase()}
                      </Text>
                      <Button
                        size="xs"
                        iconBefore="plus"
                        onClick={() => {
                          setProducts((items) => [...items, result]);
                        }}
                      >
                        Add
                      </Button>
                    </li>
                  ))}
              </ul>
              <div>
                <Button
                  appearance="primary"
                  isLoading={isPending}
                  onClick={() =>
                    void run(
                      {
                        url: `/api/admin/collections/${selected.collection.id}/products`,
                        method: 'PUT',
                        body: { productIds: products.map(({ productId }) => productId) },
                      },
                      'Collection products saved',
                    )
                  }
                >
                  Save product list
                </Button>
              </div>
            </>
          ) : null}
        </section>
      )}
      <Modal
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={current === null ? 'New collection' : `Edit ${current.name}`}
        footer={
          <>
            <Button
              onClick={() => {
                setEditing(null);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" form={formId} appearance="primary" isLoading={isPending}>
              Save collection
            </Button>
          </>
        }
      >
        {failure === null ? null : <InlineAlert tone="danger">{failure.message}</InlineAlert>}
        <form
          id={formId}
          noValidate
          onSubmit={(event) => void save(event)}
          className="grid grid-cols-1 gap-md md:grid-cols-2"
        >
          <FormField
            label="Name"
            name="name"
            defaultValue={current?.name ?? ''}
            error={fieldErrors['name']}
          />
          <FormField
            label="Slug"
            name="slug"
            defaultValue={current?.slug ?? ''}
            error={fieldErrors['slug'] ?? failure?.fieldErrors['slug']}
          />
          <FormField
            label="Description"
            name="description"
            defaultValue={current?.description ?? ''}
            error={fieldErrors['description']}
          />
          <Checkbox name="isActive" label="Active" defaultChecked={current?.isActive ?? true} />
          <FormField
            label="Starts (optional)"
            name="startsAt"
            type="datetime-local"
            defaultValue={toLocalInput(current?.startsAt ?? null)}
            error={fieldErrors['startsAt']}
          />
          <FormField
            label="Ends (optional)"
            name="endsAt"
            type="datetime-local"
            defaultValue={toLocalInput(current?.endsAt ?? null)}
            error={fieldErrors['endsAt']}
          />
        </form>
      </Modal>
    </div>
  );
}
