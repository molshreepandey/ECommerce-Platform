'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { FormField } from '@/components/molecules/FormField';
import { type FieldErrors, firstMessages } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import {
  type StoreBranding,
  storeBrandingSchema,
} from '@/modules/merchandising/store-branding.schema';
import { useAdminAction } from '../AdminActions/use-admin-action';

// D52: store name, logo and primary colour; the storefront picks them up without a deploy.
export function BrandingForm({
  branding,
  canWrite,
}: Readonly<{ branding: StoreBranding; canWrite: boolean }>) {
  const { run, isPending, failure } = useAdminAction();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = formReader(event.currentTarget);
    const logoUrl = text('logoUrl').trim();
    const primaryColour = text('primaryColour').trim();
    const parsed = storeBrandingSchema.safeParse({
      storeName: text('storeName'),
      logoUrl: logoUrl === '' ? null : logoUrl,
      primaryColour: primaryColour === '' ? null : primaryColour,
    });
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    await run({ url: '/api/admin/branding', method: 'PUT', body: parsed.data }, 'Branding saved');
  }

  const errors = { ...fieldErrors, ...(failure?.fieldErrors ?? {}) };
  return (
    <form
      noValidate
      aria-label="Store branding"
      onSubmit={(event) => void save(event)}
      className="flex max-w-xl flex-col gap-lg"
    >
      {failure === null ? null : <InlineAlert tone="danger">{failure.message}</InlineAlert>}
      <FormField
        label="Store name"
        name="storeName"
        disabled={!canWrite}
        defaultValue={branding.storeName}
        error={errors['storeName']}
      />
      <FormField
        label="Logo URL (optional)"
        name="logoUrl"
        hint="https, from an allowed image host"
        disabled={!canWrite}
        defaultValue={branding.logoUrl ?? ''}
        error={errors['logoUrl']}
      />
      <FormField
        label="Primary colour (optional)"
        name="primaryColour"
        hint="For example #4764cd; empty keeps the default"
        disabled={!canWrite}
        defaultValue={branding.primaryColour ?? ''}
        error={errors['primaryColour']}
      />
      {canWrite ? (
        <div>
          <Button type="submit" appearance="primary" isLoading={isPending}>
            Save branding
          </Button>
        </div>
      ) : null}
    </form>
  );
}
