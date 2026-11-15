'use client';

import Image from 'next/image';
import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { Checkbox } from '@/components/atoms/Checkbox';
import { EmptyState } from '@/components/atoms/EmptyState';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { FormField } from '@/components/molecules/FormField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { fromLocalInput, toLocalInput } from '@/lib/date-input';
import { formReader } from '@/lib/form-values';
import { bannerSchema } from '@/modules/merchandising/merchandising.schema';
import { useAdminAction } from '../AdminActions/use-admin-action';

export type BannerItem = Readonly<{
  id: string;
  title: string;
  imageUrl: string;
  linkUrl: string;
  position: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  isLive: boolean;
}>;

const formId = 'banner-form';

// D51: home-page banners with an image, an in-store link, an order and an optional date window.
export function BannerManager({
  banners,
  canWrite,
}: Readonly<{ banners: readonly BannerItem[]; canWrite: boolean }>) {
  const { run, isPending, failure, clearFailure } = useAdminAction();
  const [editing, setEditing] = useState<BannerItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<BannerItem | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = formReader(event.currentTarget);
    const parsed = bannerSchema.safeParse({
      title: text('title'),
      imageUrl: text('imageUrl'),
      linkUrl: text('linkUrl'),
      position: /^\d+$/.test(text('position').trim())
        ? Number(text('position').trim())
        : text('position'),
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
        ? { url: '/api/admin/banners', method: 'POST', body }
        : { url: `/api/admin/banners/${editing.id}`, method: 'PUT', body },
      editing === 'new' ? 'Banner created' : 'Banner saved',
    );
    if (saved !== null) setEditing(null);
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
            New banner
          </Button>
        </div>
      ) : null}
      {banners.length === 0 ? (
        <EmptyState icon="image" headingLevel={2} title="No banners yet" />
      ) : (
        <ul aria-label="Banners" className="grid grid-cols-1 gap-md lg:grid-cols-2">
          {banners.map((banner) => (
            <li
              key={banner.id}
              aria-label={banner.title}
              className="flex flex-col gap-sm rounded-default border border-lowlight bg-white p-md"
            >
              <div className="relative aspect-[16/5] overflow-hidden rounded-default bg-strokes">
                <Image
                  src={banner.imageUrl}
                  alt=""
                  fill
                  sizes="50vw"
                  className="object-cover"
                  unoptimized
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-sm">
                <Text variant="body2-medium">
                  {banner.position}. {banner.title}
                </Text>
                <Badge tone={banner.isLive ? 'success' : 'neutral'}>
                  {banner.isLive
                    ? 'showing now'
                    : banner.isActive
                      ? 'scheduled or expired'
                      : 'inactive'}
                </Badge>
              </div>
              <Text variant="body3" tone="muted">
                Links to {banner.linkUrl}
              </Text>
              {canWrite ? (
                <div className="flex gap-sm">
                  <Button
                    size="sm"
                    iconBefore="pencil"
                    aria-label={`Edit ${banner.title}`}
                    onClick={() => {
                      clearFailure();
                      setFieldErrors({});
                      setEditing(banner);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    appearance="ghost"
                    iconBefore="trash"
                    aria-label={`Delete ${banner.title}`}
                    onClick={() => {
                      setDeleting(banner);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting?.title ?? 'banner'}?`}
        description="The banner disappears from the home page. This cannot be undone."
        confirmLabel="Delete banner"
        isPending={isPending}
        onConfirm={() => {
          if (deleting === null) return;
          void run(
            { url: `/api/admin/banners/${deleting.id}`, method: 'DELETE' },
            'Banner deleted',
          ).then(() => {
            setDeleting(null);
          });
        }}
      />
      <Modal
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={current === null ? 'New banner' : `Edit ${current.title}`}
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
              Save banner
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
            label="Title"
            name="title"
            defaultValue={current?.title ?? ''}
            error={fieldErrors['title']}
          />
          <FormField
            label="Position"
            name="position"
            inputMode="numeric"
            defaultValue={String(current?.position ?? 0)}
            error={fieldErrors['position']}
          />
          <FormField
            label="Image URL"
            name="imageUrl"
            hint="https, from an allowed image host"
            defaultValue={current?.imageUrl ?? ''}
            error={fieldErrors['imageUrl'] ?? failure?.fieldErrors['imageUrl']}
          />
          <FormField
            label="Link"
            name="linkUrl"
            hint="A store path, for example /collections/festive-edit"
            defaultValue={current?.linkUrl ?? ''}
            error={fieldErrors['linkUrl']}
          />
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
          <Checkbox name="isActive" label="Active" defaultChecked={current?.isActive ?? true} />
        </form>
      </Modal>
    </div>
  );
}
