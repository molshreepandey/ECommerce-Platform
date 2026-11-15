'use client';

import { Button } from '@/components/atoms/Button';
import { Text } from '@/components/atoms/Text';
import type { QuantityStepperProps } from './quantity-stepper.types';

// − / value / + with the value announced; the buttons stop at the limits instead of failing on the server.
export function QuantityStepper({
  label,
  value,
  minimum = 1,
  maximum,
  isDisabled = false,
  onChange,
}: QuantityStepperProps) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-xs">
      <Button
        size="sm"
        appearance="default"
        iconBefore="minus"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={isDisabled || value <= minimum}
        onClick={() => {
          onChange(value - 1);
        }}
      />
      <span aria-live="polite" className="min-w-8 text-center">
        <Text as="span" variant="body2-medium">
          {value}
        </Text>
      </span>
      <Button
        size="sm"
        appearance="default"
        iconBefore="plus"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={isDisabled || value >= maximum}
        onClick={() => {
          onChange(value + 1);
        }}
      />
    </div>
  );
}
