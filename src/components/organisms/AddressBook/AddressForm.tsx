'use client';

import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Checkbox } from '@/components/atoms/Checkbox';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import type { AddressCardAddress } from '@/components/molecules/AddressCard';
import { FormField } from '@/components/molecules/FormField';
import { type FieldErrors, firstMessages, sendJson } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { createAddressSchema, updateAddressSchema } from '@/modules/identity/identity.schema';
import type { AddressFormProps } from './address-book.types';

const addressFieldNames = [
  'recipientName',
  'phone',
  'addressLine1',
  'addressLine2',
  'landmark',
  'city',
  'state',
  'pincode',
] as const;

function currentValues(address: AddressCardAddress): Readonly<Record<string, string>> {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? '',
    landmark: address.landmark ?? '',
    city: address.city,
    state: address.state,
    pincode: address.pincode,
  };
}

export function AddressForm({
  formId,
  address,
  isFirstAddress,
  onSaved,
  onPendingChange,
}: AddressFormProps) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState(isFirstAddress);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const read = formReader(event.currentTarget);
    const entered = Object.fromEntries(addressFieldNames.map((name) => [name, read(name).trim()]));
    setFormError(null);

    const parsed =
      address === null
        ? createAddressSchema.safeParse({
            ...Object.fromEntries(Object.entries(entered).filter(([, value]) => value !== '')),
            ...(isDefault ? { isDefault: true } : {}),
          })
        : updateAddressSchema.safeParse(
            Object.fromEntries(
              Object.entries(entered).filter(
                ([name, value]) => value !== currentValues(address)[name],
              ),
            ),
          );
    if (!parsed.success) {
      const errors = firstMessages(z.flattenError(parsed.error).fieldErrors);
      setFieldErrors(errors);
      if (Object.keys(errors).length === 0) setFormError(parsed.error.issues[0]?.message ?? null);
      return;
    }
    setFieldErrors({});
    onPendingChange(true);
    const result =
      address === null
        ? await sendJson('/api/store/account/addresses', { body: parsed.data })
        : await sendJson(`/api/store/account/addresses/${address.id}`, {
            method: 'PATCH',
            body: parsed.data,
          });
    onPendingChange(false);
    if (result.ok) {
      onSaved();
      return;
    }
    setFieldErrors(result.failure.fieldErrors);
    setFormError(result.failure.message);
  }

  return (
    <form
      id={formId}
      noValidate
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-md"
    >
      {formError === null ? null : <InlineAlert tone="danger">{formError}</InlineAlert>}
      <FormField
        label="Recipient name"
        name="recipientName"
        autoComplete="name"
        defaultValue={address?.recipientName}
        required
        error={fieldErrors['recipientName']}
      />
      <FormField
        label="Mobile number"
        name="phone"
        type="tel"
        autoComplete="tel-national"
        inputMode="numeric"
        maxLength={10}
        defaultValue={address?.phone}
        required
        error={fieldErrors['phone']}
      />
      <FormField
        label="Address line 1"
        name="addressLine1"
        autoComplete="address-line1"
        hint="House number, building and street"
        defaultValue={address?.addressLine1}
        required
        error={fieldErrors['addressLine1']}
      />
      <FormField
        label="Address line 2 (optional)"
        name="addressLine2"
        autoComplete="address-line2"
        defaultValue={address?.addressLine2 ?? ''}
        error={fieldErrors['addressLine2']}
      />
      <FormField
        label="Landmark (optional)"
        name="landmark"
        defaultValue={address?.landmark ?? ''}
        error={fieldErrors['landmark']}
      />
      <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
        <FormField
          label="City"
          name="city"
          autoComplete="address-level2"
          defaultValue={address?.city}
          required
          error={fieldErrors['city']}
        />
        <FormField
          label="State"
          name="state"
          autoComplete="address-level1"
          defaultValue={address?.state}
          required
          error={fieldErrors['state']}
        />
      </div>
      <FormField
        label="Pincode"
        name="pincode"
        autoComplete="postal-code"
        inputMode="numeric"
        maxLength={6}
        defaultValue={address?.pincode}
        required
        error={fieldErrors['pincode']}
      />
      {address === null && !isFirstAddress ? (
        <Checkbox
          label="Make this my default address"
          checked={isDefault}
          onCheckedChange={(checked) => {
            setIsDefault(checked === true);
          }}
        />
      ) : null}
    </form>
  );
}
