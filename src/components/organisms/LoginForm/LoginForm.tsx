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
import { safeNextPath } from '@/lib/safe-next-path';
import { loginSchema } from '@/modules/identity/identity.schema';
import type { LoginFormProps } from './login-form.types';

export function LoginForm({ endpoint, defaultDestination }: LoginFormProps) {
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const read = formReader(event.currentTarget);
    const parsed = loginSchema.safeParse({ email: read('email'), password: read('password') });
    setFormError(null);
    if (!parsed.success) {
      setFieldErrors(firstMessages(z.flattenError(parsed.error).fieldErrors));
      return;
    }
    setFieldErrors({});
    setIsPending(true);
    const result = await sendJson(endpoint, { body: parsed.data });
    if (result.ok) {
      const requested = safeNextPath(new URLSearchParams(window.location.search).get('next'));
      router.replace(requested ?? defaultDestination);
      router.refresh();
      return;
    }
    setIsPending(false);
    setFieldErrors(result.failure.fieldErrors);
    setFormError(result.failure.message);
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-lg"
    >
      {formError === null ? null : <InlineAlert tone="danger">{formError}</InlineAlert>}
      <FormField
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        required
        error={fieldErrors['email']}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        required
        error={fieldErrors['password']}
      />
      <Button type="submit" appearance="primary" size="lg" isFullWidth isLoading={isPending}>
        Sign in
      </Button>
    </form>
  );
}
