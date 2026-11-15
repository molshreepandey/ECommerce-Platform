'use client';

import { useRouter } from 'next/navigation';
import { type SubmitEvent, useState } from 'react';
import { Badge } from '@/components/atoms/Badge';
import { Button } from '@/components/atoms/Button';
import { Card } from '@/components/atoms/Card';
import { Heading } from '@/components/atoms/Heading';
import { InlineAlert } from '@/components/atoms/InlineAlert';
import { Link } from '@/components/atoms/Link';
import { Modal } from '@/components/atoms/Modal';
import { RadioGroup } from '@/components/atoms/RadioGroup';
import { Text } from '@/components/atoms/Text';
import { useToast } from '@/components/atoms/Toast';
import { FormField } from '@/components/molecules/FormField';
import { QuantityStepper } from '@/components/molecules/QuantityStepper';
import { SelectField } from '@/components/molecules/SelectField';
import { sendJson } from '@/lib/api-client';
import { formatDate } from '@/lib/date-format';
import { formReader } from '@/lib/form-values';

export type ReturnableLineItem = Readonly<{
  orderItemId: string;
  productName: string;
  returnableQuantity: number;
  windowEndsAt: string | null;
  exchangeOptions: readonly { variantId: string; label: string }[];
}>;

export type CustomerReturnItem = Readonly<{
  id: string;
  returnNumber: string;
  requestType: 'RETURN' | 'EXCHANGE';
  status: string;
  requestedAt: string;
  resolutionNote: string | null;
  exchangeOrderId: string | null;
}>;

const statusTone: Readonly<Record<string, 'info' | 'success' | 'danger' | 'neutral'>> = {
  REQUESTED: 'info',
  APPROVED: 'info',
  PICKED_UP: 'info',
  RECEIVED: 'info',
  RESTOCKED: 'info',
  REFUNDED: 'success',
  EXCHANGED: 'success',
  REJECTED: 'danger',
};

const formId = 'return-request-form';

// C37: request a return or an exchange for delivered items inside the return window, and follow it.
export function ReturnRequestPanel({
  orderId,
  lines,
  requests,
}: Readonly<{
  orderId: string;
  lines: readonly ReturnableLineItem[];
  requests: readonly CustomerReturnItem[];
}>) {
  const router = useRouter();
  const { showToast } = useToast();
  const eligible = lines.filter((line) => line.returnableQuantity > 0);
  const [isOpen, setIsOpen] = useState(false);
  const [requestType, setRequestType] = useState<'RETURN' | 'EXCHANGE'>('RETURN');
  const [quantities, setQuantities] = useState<Readonly<Record<string, number>>>({});
  const [replacements, setReplacements] = useState<Readonly<Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  if (eligible.length === 0 && requests.length === 0) return null;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = eligible
      .filter((line) => (quantities[line.orderItemId] ?? 0) > 0)
      .map((line) => ({
        orderItemId: line.orderItemId,
        quantity: quantities[line.orderItemId] ?? 0,
        ...(requestType === 'EXCHANGE'
          ? {
              exchangeVariantId:
                replacements[line.orderItemId] ?? line.exchangeOptions[0]?.variantId,
            }
          : {}),
      }));
    if (items.length === 0) {
      setError('Choose at least one item.');
      return;
    }
    setIsPending(true);
    const result = await sendJson(`/api/store/orders/${orderId}/returns`, {
      body: { requestType, reason: formReader(event.currentTarget)('reason'), items },
    });
    setIsPending(false);
    if (!result.ok) {
      setError(result.failure.fieldErrors['reason'] ?? result.failure.message);
      return;
    }
    setIsOpen(false);
    showToast({
      title: requestType === 'RETURN' ? 'Return requested' : 'Exchange requested',
      tone: 'success',
    });
    router.refresh();
  }

  return (
    <Card as="section" aria-labelledby="returns-heading">
      <div className="flex flex-col gap-md">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <Heading level={2} variant="heading5" id="returns-heading">
            Returns and exchanges
          </Heading>
          {eligible.length === 0 ? null : (
            <Button
              size="sm"
              iconBefore="undo"
              onClick={() => {
                setError(null);
                setIsOpen(true);
              }}
            >
              Return or exchange items
            </Button>
          )}
        </div>
        {eligible.length === 0 ? null : (
          <Text variant="body3" tone="muted">
            Returns are open until{' '}
            {eligible
              .map((line) => (line.windowEndsAt === null ? '' : formatDate(line.windowEndsAt)))
              .filter((text) => text !== '')
              .sort()[0] ?? '—'}
            .
          </Text>
        )}
        {requests.length === 0 ? null : (
          <ul className="flex flex-col gap-xs">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-sm">
                <Text as="span" variant="body3">
                  {request.returnNumber} ·{' '}
                  {request.requestType === 'RETURN' ? 'return' : 'exchange'} · requested{' '}
                  {formatDate(request.requestedAt)}
                  {request.resolutionNote === null ? '' : ` · ${request.resolutionNote}`}
                </Text>
                <Badge tone={statusTone[request.status] ?? 'neutral'}>
                  {request.status.toLowerCase().replace('_', ' ')}
                </Badge>
                {request.exchangeOrderId === null ? null : (
                  <Link href={`/orders/${request.exchangeOrderId}`} variant="body3">
                    Replacement order
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Modal
        open={isOpen}
        onOpenChange={setIsOpen}
        title="Return or exchange items"
        footer={
          <>
            <Button
              onClick={() => {
                setIsOpen(false);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" form={formId} appearance="primary" isLoading={isPending}>
              Send request
            </Button>
          </>
        }
      >
        {error === null ? null : <InlineAlert tone="danger">{error}</InlineAlert>}
        <form
          id={formId}
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-md"
        >
          <RadioGroup
            name="requestType"
            label="What would you like?"
            value={requestType}
            onValueChange={(value) => {
              setRequestType(value === 'EXCHANGE' ? 'EXCHANGE' : 'RETURN');
            }}
            options={[
              { value: 'RETURN', label: 'Return for a refund' },
              { value: 'EXCHANGE', label: 'Exchange for another size or colour' },
            ]}
          />
          {eligible.map((line) => (
            <div
              key={line.orderItemId}
              className="flex flex-col gap-xs border-t border-strokes pt-sm"
            >
              <Text variant="body2-medium">{line.productName}</Text>
              <QuantityStepper
                label={`Quantity of ${line.productName}`}
                value={quantities[line.orderItemId] ?? 0}
                minimum={0}
                maximum={line.returnableQuantity}
                onChange={(value) => {
                  setQuantities((current) => ({ ...current, [line.orderItemId]: value }));
                }}
              />
              {requestType === 'EXCHANGE' && line.exchangeOptions.length > 0 ? (
                <SelectField
                  label="Replace with"
                  name={`replacement-${line.orderItemId}`}
                  options={line.exchangeOptions.map((option) => ({
                    value: option.variantId,
                    label: option.label,
                  }))}
                  value={replacements[line.orderItemId] ?? line.exchangeOptions[0]?.variantId ?? ''}
                  onValueChange={(value) => {
                    setReplacements((current) => ({ ...current, [line.orderItemId]: value }));
                  }}
                />
              ) : null}
            </div>
          ))}
          <FormField label="Reason" name="reason" maxLength={300} />
        </form>
      </Modal>
    </Card>
  );
}
