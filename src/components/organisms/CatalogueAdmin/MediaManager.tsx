'use client';

import Image from 'next/image';
import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { EmptyState } from '@/components/atoms/EmptyState';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { FormField } from '@/components/molecules/FormField';
import { SelectField } from '@/components/molecules/SelectField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { addMediaSchema, updateMediaSchema } from '@/modules/catalogue/catalogue.schema';
import { ActionFailure, useCatalogueAction } from './catalogue-actions';
import { displayImageUrl } from '@/modules/catalogue/catalogue-art';

export type MediaItem = Readonly<{
  id: string;
  url: string;
  altText: string;
  position: number;
  variantId: string | null;
}>;
export type VariantChoice = Readonly<{ id: string; sku: string }>;

type Dialog = { kind: 'add' } | { kind: 'edit'; media: MediaItem };
const noVariant = '__product__';
const formId = 'media-form';

function moved(ids: readonly string[], index: number, offset: -1 | 1): string[] {
  const next = [...ids];
  const target = index + offset;
  const current = next[index];
  const neighbour = next[target];
  if (current === undefined || neighbour === undefined) return next;
  next[index] = neighbour;
  next[target] = current;
  return next;
}

export function MediaManager({
  productId,
  media,
  variants,
  canEdit,
}: Readonly<{
  productId: string;
  media: readonly MediaItem[];
  variants: readonly VariantChoice[];
  canEdit: boolean;
}>) {
  const { run, pendingKey, failure, clearFailure } = useCatalogueAction();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [variantId, setVariantId] = useState(noVariant);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [toDelete, setToDelete] = useState<MediaItem | null>(null);
  const variantOptions = [
    { value: noVariant, label: 'Whole product' },
    ...variants.map(({ id, sku }) => ({ value: id, label: sku })),
  ];
  const skuById = new Map(variants.map(({ id, sku }) => [id, sku]));

  function open(next: Dialog) {
    clearFailure();
    setFieldErrors({});
    setVariantId(next.kind === 'edit' ? (next.media.variantId ?? noVariant) : noVariant);
    setDialog(next);
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog === null) return;
    const read = formReader(event.currentTarget);
    const linkedVariant = variantId === noVariant ? null : variantId;
    const parsed =
      dialog.kind === 'add'
        ? addMediaSchema.safeParse({
            url: read('url'),
            altText: read('altText'),
            variantId: linkedVariant,
          })
        : updateMediaSchema.safeParse({ altText: read('altText'), variantId: linkedVariant });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    const saved = await run(
      'media',
      dialog.kind === 'add'
        ? { url: `/api/admin/products/${productId}/media`, method: 'POST', body: parsed.data }
        : { url: `/api/admin/media/${dialog.media.id}`, method: 'PATCH', body: parsed.data },
      dialog.kind === 'add' ? 'Image added' : 'Image updated',
    );
    if (saved !== null) setDialog(null);
  }

  function reorder(index: number, offset: -1 | 1) {
    const mediaIds = moved(
      media.map(({ id }) => id),
      index,
      offset,
    );
    void run(
      `move-${String(index)}`,
      { url: `/api/admin/products/${productId}/media/order`, method: 'PUT', body: { mediaIds } },
      'Image order saved',
    );
  }

  const errors = { ...fieldErrors, ...(failure?.fieldErrors ?? {}) };
  return (
    <div className="flex flex-col gap-lg">
      {dialog === null ? <ActionFailure failure={failure} /> : null}
      {canEdit ? (
        <div>
          <Button
            appearance="primary"
            iconBefore="image"
            onClick={() => {
              open({ kind: 'add' });
            }}
          >
            Add image
          </Button>
        </div>
      ) : null}
      {media.length === 0 ? (
        <EmptyState
          icon="image"
          headingLevel={2}
          title="No images yet"
          description="Add image URLs from an allowed image host."
        />
      ) : (
        <ol aria-label="Images" className="flex flex-col gap-sm">
          {media.map((item, index) => (
            <li
              key={item.id}
              className="flex flex-col gap-sm rounded-default border border-lowlight bg-white p-md md:flex-row md:items-center md:justify-between"
            >
              <div className="flex min-w-0 items-center gap-md">
                <Image
                  src={displayImageUrl(item.url)}
                  alt={item.altText}
                  width={64}
                  height={80}
                  unoptimized
                  className="h-20 w-16 shrink-0 rounded-default object-cover"
                />
                <div className="flex min-w-0 flex-col gap-xs">
                  <Text variant="body2-medium">
                    {index + 1}. {item.altText}
                  </Text>
                  <Text variant="body3" tone="muted" isTruncated>
                    {item.variantId === null
                      ? 'Whole product'
                      : `Variant ${skuById.get(item.variantId) ?? ''}`}
                  </Text>
                </div>
              </div>
              {canEdit ? (
                <div className="flex flex-wrap gap-xs">
                  <Button
                    size="sm"
                    iconBefore="arrow-up"
                    disabled={index === 0}
                    isLoading={pendingKey === `move-${String(index)}`}
                    onClick={() => {
                      reorder(index, -1);
                    }}
                  >
                    Move up
                  </Button>
                  <Button
                    size="sm"
                    iconBefore="arrow-down"
                    disabled={index === media.length - 1}
                    onClick={() => {
                      reorder(index, 1);
                    }}
                  >
                    Move down
                  </Button>
                  <Button
                    size="sm"
                    iconBefore="pencil"
                    onClick={() => {
                      open({ kind: 'edit', media: item });
                    }}
                  >
                    Edit image {index + 1}
                  </Button>
                  <Button
                    size="sm"
                    appearance="subtle"
                    iconBefore="trash"
                    onClick={() => {
                      setToDelete(item);
                    }}
                  >
                    Delete image {index + 1}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <Modal
        open={dialog !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDialog(null);
        }}
        title={dialog?.kind === 'edit' ? 'Edit image' : 'Add image'}
        footer={
          <>
            <Button
              onClick={() => {
                setDialog(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              appearance="primary"
              isLoading={pendingKey === 'media'}
            >
              Save image
            </Button>
          </>
        }
      >
        {dialog === null ? null : (
          <form
            id={formId}
            noValidate
            className="flex flex-col gap-md"
            onSubmit={(event) => void handleSubmit(event)}
          >
            <ActionFailure failure={failure} />
            {dialog.kind === 'add' ? (
              <FormField
                label="Image URL"
                name="url"
                type="url"
                hint="An https address on an allowed image host."
                error={errors['url']}
              />
            ) : null}
            <FormField
              label="Alt text"
              name="altText"
              defaultValue={dialog.kind === 'edit' ? dialog.media.altText : ''}
              hint="Describe the image for people using screen readers."
              error={errors['altText']}
            />
            <SelectField
              label="Shows"
              name="variantId"
              options={variantOptions}
              value={variantId}
              error={errors['variantId']}
              onValueChange={setVariantId}
            />
          </form>
        )}
      </Modal>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setToDelete(null);
        }}
        title="Delete this image?"
        description={
          toDelete === null
            ? ''
            : `“${toDelete.altText}” will be removed. The audit trail keeps a record of it.`
        }
        confirmLabel="Delete image"
        isPending={pendingKey === 'delete'}
        onConfirm={() => {
          if (toDelete === null) return;
          void run(
            'delete',
            { url: `/api/admin/media/${toDelete.id}`, method: 'DELETE' },
            'Image deleted',
          ).then(() => {
            setToDelete(null);
          });
        }}
      />
    </div>
  );
}
