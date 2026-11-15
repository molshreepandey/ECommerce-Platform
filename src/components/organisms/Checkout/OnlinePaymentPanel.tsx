'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { Badge } from '@/components/atoms/Badge';
import { Button, ButtonLink } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { Heading } from '@/components/atoms/Heading';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Text } from '@/components/atoms/Text';
import { sendJson } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';

const attemptSchema = z.object({
  attempt: z.object({
    outcome: z.enum(['SUCCEEDED', 'DECLINED']),
    message: z.string(),
    paymentStatus: z.string(),
    orderStatus: z.string(),
    attemptsRemaining: z.number(),
  }),
});

type Scenario = 'SUCCESS' | 'DECLINE_INSUFFICIENT_FUNDS' | 'DECLINE_BANK_UNAVAILABLE';

const scenarios: readonly {
  scenario: Scenario;
  label: string;
  appearance: 'primary' | 'default';
}[] = [
  { scenario: 'SUCCESS', label: 'Pay now (simulated success)', appearance: 'primary' },
  {
    scenario: 'DECLINE_INSUFFICIENT_FUNDS',
    label: 'Simulate decline: insufficient funds',
    appearance: 'default',
  },
  {
    scenario: 'DECLINE_BANK_UNAVAILABLE',
    label: 'Simulate decline: bank unavailable',
    appearance: 'default',
  },
];

// The simulated gateway screen: the chosen scenario decides the result, so demos and tests are repeatable.
// Each click is one payment attempt with its own Idempotency-Key; a retried request reuses it.
export function OnlinePaymentPanel({
  orderId,
  orderNumber,
  amountPaise,
  attemptsRemaining,
}: Readonly<{
  orderId: string;
  orderNumber: string;
  amountPaise: number;
  attemptsRemaining: number;
}>) {
  const router = useRouter();
  const [pendingScenario, setPendingScenario] = useState<Scenario | null>(null);
  const [message, setMessage] = useState<{ tone: 'danger' | 'warning'; text: string } | null>(null);
  const [remaining, setRemaining] = useState(attemptsRemaining);

  async function pay(scenario: Scenario) {
    setPendingScenario(scenario);
    setMessage(null);
    const result = await sendJson(`/api/store/orders/${orderId}/payments`, {
      body: { scenario, amountPaise },
      headers: { 'Idempotency-Key': `payment-${crypto.randomUUID()}` },
    });
    setPendingScenario(null);
    if (!result.ok) {
      setMessage({ tone: 'danger', text: result.failure.message });
      router.refresh();
      return;
    }
    const parsed = attemptSchema.safeParse(result.data);
    if (!parsed.success) return;
    const { attempt } = parsed.data;
    if (attempt.outcome === 'SUCCEEDED') {
      router.push(`/orders/${orderId}?placed=1`);
      router.refresh();
      return;
    }
    setRemaining(attempt.attemptsRemaining);
    if (attempt.orderStatus === 'CANCELLED') {
      router.push(`/orders/${orderId}`);
      router.refresh();
      return;
    }
    setMessage({
      tone: 'warning',
      text: `${attempt.message} ${String(attempt.attemptsRemaining)} ${attempt.attemptsRemaining === 1 ? 'attempt' : 'attempts'} left.`,
    });
  }

  return (
    <Card elevation="raised">
      <div className="flex flex-col gap-lg">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <Heading level={2} variant="heading3">
            Pay {formatPaise(amountPaise)}
          </Heading>
          <Badge tone="info">Simulated gateway</Badge>
        </div>
        <Text tone="subtitle">
          Order {orderNumber}. This demo store uses a simulated payment gateway: no card details are
          asked for and no money moves. Choose the result you want to try.
        </Text>
        {message === null ? null : <InlineAlert tone={message.tone}>{message.text}</InlineAlert>}
        <div className="flex flex-col gap-sm">
          {scenarios.map((option) => (
            <Button
              key={option.scenario}
              appearance={option.appearance}
              size="lg"
              isFullWidth
              {...(option.scenario === 'SUCCESS' ? { iconBefore: 'credit-card' as const } : {})}
              disabled={pendingScenario !== null || remaining === 0}
              isLoading={pendingScenario === option.scenario}
              onClick={() => void pay(option.scenario)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <Text variant="body3" tone="muted">
          After {remaining === 1 ? 'one more' : String(remaining)} declined{' '}
          {remaining === 1 ? 'attempt' : 'attempts'}, or 30 minutes without payment, the order is
          cancelled and its items are released.
        </Text>
        <ButtonLink href={`/orders/${orderId}`} appearance="ghost">
          Pay later from your orders
        </ButtonLink>
      </div>
    </Card>
  );
}
