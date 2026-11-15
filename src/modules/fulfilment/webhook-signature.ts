import { createHmac, timingSafeEqual } from 'node:crypto';

export const webhookSignatureHeader = 'X-Courier-Signature';
const toleranceSeconds = 300;

// Header format "t=<unix seconds>,v1=<hex HMAC-SHA256 of '<t>.<raw body>'>" (plan §10B: constant-time
// compare plus a timestamp tolerance against replays).
export function signWebhook(secret: string, rawBody: string, now: Date): string {
  const timestamp = Math.floor(now.getTime() / 1000);
  const digest = createHmac('sha256', secret)
    .update(`${String(timestamp)}.${rawBody}`)
    .digest('hex');
  return `t=${String(timestamp)},v1=${digest}`;
}

export function verifyWebhookSignature(input: {
  secret: string;
  rawBody: string;
  signatureHeader: string | null;
  now: Date;
}): boolean {
  if (input.signatureHeader === null) return false;
  const parts = new Map(
    input.signatureHeader.split(',').map((part) => {
      const [key = '', value = ''] = part.split('=', 2);
      return [key.trim(), value.trim()] as const;
    }),
  );
  const timestamp = Number(parts.get('t'));
  const signature = parts.get('v1') ?? '';
  if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(input.now.getTime() / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = createHmac('sha256', input.secret)
    .update(`${String(timestamp)}.${input.rawBody}`)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
