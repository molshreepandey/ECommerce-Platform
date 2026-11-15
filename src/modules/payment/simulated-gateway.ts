import { randomUUID } from 'node:crypto';

import { getEnvironment } from '@/lib/env';

// The simulated online gateway (owner decision 2026-11-14): no network and no card data. The scenario the
// customer picks decides the outcome, so every test and demo run behaves the same way.

// Because the customer picks the outcome, the simulation must never take orders in production: there,
// online payment is unavailable until a real gateway adapter exists (COD still works).
export function isSimulatedGatewayAvailable(): boolean {
  return getEnvironment().APP_ENV !== 'production';
}
export const simulatedPaymentScenarios = [
  'SUCCESS',
  'DECLINE_INSUFFICIENT_FUNDS',
  'DECLINE_BANK_UNAVAILABLE',
] as const;

export type SimulatedPaymentScenario = (typeof simulatedPaymentScenarios)[number];

export type SimulatedGatewayResult =
  | { outcome: 'SUCCEEDED'; providerReference: string }
  | { outcome: 'DECLINED'; declineCode: string; providerReference: string };

export function chargeSimulatedGateway(scenario: SimulatedPaymentScenario): SimulatedGatewayResult {
  const providerReference = `SIMPAY-${randomUUID()}`;
  switch (scenario) {
    case 'SUCCESS':
      return { outcome: 'SUCCEEDED', providerReference };
    case 'DECLINE_INSUFFICIENT_FUNDS':
      return { outcome: 'DECLINED', declineCode: 'INSUFFICIENT_FUNDS', providerReference };
    case 'DECLINE_BANK_UNAVAILABLE':
      return { outcome: 'DECLINED', declineCode: 'BANK_UNAVAILABLE', providerReference };
  }
}

export const declineMessages: Readonly<Record<string, string>> = {
  INSUFFICIENT_FUNDS: 'The bank declined the payment: insufficient funds.',
  BANK_UNAVAILABLE: 'The bank could not be reached. Try again.',
};
