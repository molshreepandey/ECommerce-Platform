import { z } from 'zod';

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown(),
  }),
});
const fieldErrorsDetailsSchema = z.object({
  fieldErrors: z.record(z.string(), z.array(z.string()).optional()),
});

export type FieldErrors = Readonly<Record<string, string | undefined>>;

export type ApiFailure = Readonly<{
  status: number;
  code: string;
  message: string;
  fieldErrors: FieldErrors;
}>;

export type ApiResult = { ok: true; data: unknown } | { ok: false; failure: ApiFailure };

const networkFailure: ApiFailure = {
  status: 0,
  code: 'NETWORK_ERROR',
  message: 'We could not reach the server. Check your connection and try again.',
  fieldErrors: {},
};

export function firstMessages(
  fieldErrors: Readonly<Record<string, readonly string[] | undefined>>,
): FieldErrors {
  return Object.fromEntries(
    Object.entries(fieldErrors).map(([field, messages]) => [field, messages?.[0]]),
  );
}

async function failureFrom(response: Response): Promise<ApiFailure> {
  const parsed = errorEnvelopeSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    return {
      status: response.status,
      code: 'UNEXPECTED_RESPONSE',
      message: 'Something went wrong. Please try again.',
      fieldErrors: {},
    };
  }
  const details = fieldErrorsDetailsSchema.safeParse(parsed.data.error.details);
  return {
    status: response.status,
    code: parsed.data.error.code,
    message: parsed.data.error.message,
    fieldErrors: details.success ? firstMessages(details.data.fieldErrors) : {},
  };
}

// Same-origin JSON call from the browser; the session cookie travels automatically.
export async function sendJson(
  url: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<ApiResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'POST',
      headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      credentials: 'same-origin',
    });
  } catch {
    return { ok: false, failure: networkFailure };
  }
  if (!response.ok) return { ok: false, failure: await failureFrom(response) };
  if (response.status === 204) return { ok: true, data: null };
  return { ok: true, data: await response.json().catch(() => null) };
}
