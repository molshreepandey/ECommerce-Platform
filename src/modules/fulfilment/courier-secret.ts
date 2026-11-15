import { createHmac } from 'node:crypto';

import { getEnvironment } from '@/lib/env';

// Local development and tests sign with a fixed, public secret; every other environment must set
// COURIER_WEBHOOK_SECRET, or webhooks and the simulate button refuse to run.
export const localOnlyCourierSecret = 'local-demo-courier-secret-not-for-deployment';

export function courierWebhookSecret(): string {
  const environment = getEnvironment();
  if (environment.COURIER_WEBHOOK_SECRET !== undefined) return environment.COURIER_WEBHOOK_SECRET;
  if (environment.APP_ENV === 'development' || environment.APP_ENV === 'test')
    return localOnlyCourierSecret;
  throw new Error('COURIER_WEBHOOK_SECRET must be set outside development and test');
}

// L2: each courier partner signs with its own key, derived from the master secret and the partner code,
// so events signed for one partner are refused at another partner's webhook URL. A real partner adapter
// would instead use the secret that partner issues.
export function deriveCourierSigningKey(masterSecret: string, partnerCode: string): string {
  return createHmac('sha256', masterSecret)
    .update(`courier-webhook:v1:${partnerCode}`)
    .digest('hex');
}

export function courierSigningKey(partnerCode: string): string {
  return deriveCourierSigningKey(courierWebhookSecret(), partnerCode);
}
