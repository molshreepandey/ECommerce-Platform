'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { FormField } from '@/components/molecules/FormField';
import { PasswordField } from '@/components/molecules/PasswordField';
import { type FieldErrors, firstMessages, sendJson } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { registerCustomerSchema } from '@/modules/identity/identity.schema';

const conflictFields: Readonly<Record<string, string>> = {
  EMAIL_ALREADY_REGISTERED: 'email',
  PHONE_ALREADY_REGISTERED: 'phone',
};

export function RegisterForm() {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const read = formReader(event.currentTarget);
    const parsed = registerCustomerSchema.safeParse({
      fullName: read('fullName'),
      email: read('email'),
      phone: read('phone'),
      password: read('password'),
    });
    setFormError(null);
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    setIsPending(true);
    const result = await sendJson('/api/store/auth/register', { body: parsed.data });
    if (result.ok) {
      router.replace('/account');
      router.refresh();
      return;
    }
    setIsPending(false);
    const conflictField = conflictFields[result.failure.code];
    if (conflictField === undefined) {
      setFieldErrors(result.failure.fieldErrors);
      setFormError(result.failure.message);
    } else {
      setFieldErrors({ [conflictField]: result.failure.message });
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-lg"
    >
      {formError === null ? null : <InlineAlert tone="danger">{formError}</InlineAlert>}
      <FormField
        label="Full name"
        name="fullName"
        autoComplete="name"
        required
        error={fieldErrors['fullName']}
      />
      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        error={fieldErrors['email']}
      />
      <FormField
        label="Mobile number"
        name="phone"
        type="tel"
        autoComplete="tel-national"
        inputMode="numeric"
        maxLength={10}
        hint="10 digits, without +91"
        required
        error={fieldErrors['phone']}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        hint="At least 8 characters"
        required
        error={fieldErrors['password']}
      />
      <Button type="submit" appearance="primary" size="lg" isFullWidth isLoading={isPending}>
        Create account
      </Button>
    </form>
  );
}
