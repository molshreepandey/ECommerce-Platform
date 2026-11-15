import { z } from 'zod';

import { webhookHandler } from '@/lib/api-handler';
import { DomainError } from '@/lib/errors';
import { readTextWithin } from '@/lib/request-body';
import { webhookSignatureHeader } from '@/modules/fulfilment/webhook-signature';
import { processCourierWebhook } from '@/modules/ordering/courier-webhook.service';

const maximumWebhookBytes = 64 * 1024;

// D42 / plan §8 and §10B: HMAC-signed courier tracking events; the raw body is verified before parsing.
export const POST = webhookHandler(
  async (request, { params }: { params: Promise<{ provider: string }> }, requestContext) => {
    const provider = z
      .string()
      .regex(/^[a-z0-9_-]{1,40}$/)
      .safeParse((await params).provider);
    if (!provider.success) {
      throw new DomainError({
        kind: 'NOT_FOUND',
        code: 'COURIER_NOT_FOUND',
        message: 'Unknown courier.',
      });
    }
    // Unauthenticated until the signature is checked, so the size is enforced while reading (L1).
    const rawBody = await readTextWithin(request, maximumWebhookBytes);
    if (rawBody === null) {
      throw new DomainError({
        kind: 'VALIDATION',
        code: 'WEBHOOK_TOO_LARGE',
        message: 'The webhook body is too large.',
      });
    }
    const result = await processCourierWebhook({
      providerCode: provider.data,
      rawBody,
      signatureHeader: request.headers.get(webhookSignatureHeader),
      requestId: requestContext.requestId,
    });
    return Response.json(result);
  },
);
