'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/atoms/Button';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Modal } from '@/components/atoms/Modal';
import { Text } from '@/components/atoms/Text';
import { FormField } from '@/components/molecules/FormField';
import { sendJson } from '@/lib/api-client';
import { formReader } from '@/lib/form-values';
import { safeNextPath } from '@/lib/safe-next-path';

const requestResponseSchema = z.object({
  otp: z.object({ resendAvailableAt: z.string(), displayedOtpCode: z.string().optional() }),
});

// Plan C3: sign in with a one-time code. No SMS is sent (log_otp_sender); in staging and demos the code
// is shown in a popup, labelled as such.
export function OtpLoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState<string | null>(null);
  const [displayedCode, setDisplayedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function requestCode(phoneNumber: string) {
    setIsPending(true);
    setError(null);
    const result = await sendJson('/api/store/auth/otp/request', { body: { phone: phoneNumber } });
    setIsPending(false);
    if (!result.ok) {
      setError(result.failure.fieldErrors['phone'] ?? result.failure.message);
      return;
    }
    const parsed = requestResponseSchema.safeParse(result.data);
    setPhone(phoneNumber);
    setDisplayedCode(parsed.success ? (parsed.data.otp.displayedOtpCode ?? null) : null);
  }

  async function verify(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phone === null) return;
    const code = formReader(event.currentTarget)('code').trim();
    setIsPending(true);
    setError(null);
    const result = await sendJson('/api/store/auth/otp/verify', { body: { phone, code } });
    setIsPending(false);
    if (!result.ok) {
      setError(result.failure.fieldErrors['code'] ?? result.failure.message);
      return;
    }
    router.replace(
      safeNextPath(new URLSearchParams(window.location.search).get('next')) ?? '/account',
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-md">
      {error === null ? null : <InlineAlert tone="danger">{error}</InlineAlert>}
      {phone === null ? (
        <form
          noValidate
          aria-label="Sign in with a one-time code"
          onSubmit={(event) => {
            event.preventDefault();
            void requestCode(formReader(event.currentTarget)('phone').trim());
          }}
          className="flex flex-col gap-md"
        >
          <FormField
            label="Mobile number"
            name="phone"
            inputMode="tel"
            autoComplete="tel-national"
            maxLength={10}
          />
          <Button type="submit" appearance="default" isFullWidth isLoading={isPending}>
            Send a one-time code
          </Button>
        </form>
      ) : (
        <form
          noValidate
          aria-label="Enter the one-time code"
          onSubmit={(event) => void verify(event)}
          className="flex flex-col gap-md"
        >
          <Text variant="body3" tone="subtitle">
            If {phone} has an account, a 6-digit code was issued. It is valid for 5 minutes.
          </Text>
          <FormField
            label="One-time code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
          />
          <Button type="submit" appearance="primary" isFullWidth isLoading={isPending}>
            Verify and sign in
          </Button>
          <Button appearance="link" disabled={isPending} onClick={() => void requestCode(phone)}>
            Send a new code
          </Button>
        </form>
      )}
      <Modal
        open={displayedCode !== null}
        onOpenChange={(open) => {
          if (!open) setDisplayedCode(null);
        }}
        title="Your one-time code"
        description="Staging/demo: OTP is shown here because SMS is not integrated"
        footer={
          <Button
            appearance="primary"
            onClick={() => {
              setDisplayedCode(null);
            }}
          >
            Got it
          </Button>
        }
      >
        <Text variant="body1-medium" align="center">
          <span aria-label="One-time code">{displayedCode}</span>
        </Text>
      </Modal>
    </div>
  );
}
