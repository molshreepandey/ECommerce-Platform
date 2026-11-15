import { describe, expect, it } from 'vitest';
import { signWebhook, verifyWebhookSignature } from './webhook-signature';

const secret = 'test-secret';
const now = new Date('2026-11-14T10:00:00Z');
const body = '{"events":[]}';

describe('webhook signature', () => {
  it('accepts its own signature', () => {
    const signatureHeader = signWebhook(secret, body, now);
    expect(verifyWebhookSignature({ secret, rawBody: body, signatureHeader, now })).toBe(true);
  });

  it('refuses a changed body, another secret, a missing or malformed header', () => {
    const signatureHeader = signWebhook(secret, body, now);
    expect(verifyWebhookSignature({ secret, rawBody: `${body} `, signatureHeader, now })).toBe(
      false,
    );
    expect(verifyWebhookSignature({ secret: 'other', rawBody: body, signatureHeader, now })).toBe(
      false,
    );
    expect(verifyWebhookSignature({ secret, rawBody: body, signatureHeader: null, now })).toBe(
      false,
    );
    expect(verifyWebhookSignature({ secret, rawBody: body, signatureHeader: 'v1=abc', now })).toBe(
      false,
    );
  });

  it('refuses a signature older than five minutes', () => {
    const signatureHeader = signWebhook(secret, body, new Date(now.getTime() - 301_000));
    expect(verifyWebhookSignature({ secret, rawBody: body, signatureHeader, now })).toBe(false);
  });
});
