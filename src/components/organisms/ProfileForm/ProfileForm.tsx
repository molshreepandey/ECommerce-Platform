'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Text } from '@/components/atoms/Text';
import { useToast } from '@/components/atoms/Toast';
import { FormField } from '@/components/molecules/FormField';
import { type FieldErrors, firstMessages, sendJson } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { updateProfileSchema } from '@/modules/identity/identity.schema';
import type { ProfileFormProps } from './profile-form.types';

export function ProfileForm({ profile }: ProfileFormProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const read = formReader(event.currentTarget);
    const fullName = read('fullName').trim();
    const phone = read('phone').trim();
    const currentPassword = read('currentPassword');
    const changes = {
      ...(fullName === profile.fullName ? {} : { fullName }),
      ...(phone === profile.phone ? {} : { phone }),
    };
    // The server asks for the current password only when the mobile number changes (M2).
    const body =
      'phone' in changes && currentPassword !== '' ? { ...changes, currentPassword } : changes;
    setFormError(null);
    if (Object.keys(changes).length === 0) {
      setFieldErrors({});
      showToast({ title: 'Nothing to save', tone: 'info' });
      return;
    }
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    setIsPending(true);
    const result = await sendJson('/api/store/account/profile', {
      method: 'PATCH',
      body: parsed.data,
    });
    setIsPending(false);
    if (result.ok) {
      showToast({
        title:
          'phone' in changes ? 'Profile saved; other devices were signed out' : 'Profile saved',
        tone: 'success',
      });
      router.refresh();
      return;
    }
    if (result.failure.code === 'PHONE_ALREADY_REGISTERED') {
      setFieldErrors({ phone: result.failure.message });
    } else {
      setFieldErrors(result.failure.fieldErrors);
      setFormError(result.failure.message);
    }
  }

  return (
    <form
      noValidate
      aria-label="Profile"
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-lg"
    >
      {formError === null ? null : <InlineAlert tone="danger">{formError}</InlineAlert>}
      <div className="flex flex-col gap-xs">
        <Text variant="body2-medium">Email</Text>
        <Text tone="subtitle">{profile.email}</Text>
      </div>
      <FormField
        label="Full name"
        name="fullName"
        autoComplete="name"
        defaultValue={profile.fullName}
        required
        error={fieldErrors['fullName']}
      />
      <FormField
        label="Mobile number"
        name="phone"
        type="tel"
        autoComplete="tel-national"
        inputMode="numeric"
        maxLength={10}
        defaultValue={profile.phone}
        required
        error={fieldErrors['phone']}
      />
      <FormField
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        hint="Needed only to change your mobile number."
        error={fieldErrors['currentPassword']}
      />
      <div>
        <Button type="submit" appearance="primary" isLoading={isPending}>
          Save profile
        </Button>
      </div>
    </form>
  );
}
