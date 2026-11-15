'use client';

import { RadioGroup as RadixRadioGroup } from 'radix-ui';
import { useId } from 'react';
import { focusRingClassNames } from '../focus-ring';
import { Text } from '../Text';
import type { RadioGroupProps } from './radio-group.types';

// Card-style choices (delivery address, payment method) with arrow-key navigation from Radix.
export function RadioGroup({
  name,
  label,
  options,
  value,
  onValueChange,
  isDisabled = false,
}: RadioGroupProps) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-sm">
      <Text as="span" variant="body2-medium" id={labelId}>
        {label}
      </Text>
      <RadixRadioGroup.Root
        name={name}
        aria-labelledby={labelId}
        value={value ?? ''}
        onValueChange={onValueChange}
        disabled={isDisabled}
        className="grid grid-cols-1 gap-sm md:grid-cols-2"
      >
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-md rounded-card border border-lowlight bg-white p-md has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent-light-1"
          >
            <RadixRadioGroup.Item
              value={option.value}
              disabled={option.isDisabled === true}
              className={`mt-xs inline-flex size-4 shrink-0 items-center justify-center rounded-pill border border-lowlight-2 bg-white data-[state=checked]:border-primary ${focusRingClassNames}`}
            >
              <RadixRadioGroup.Indicator className="size-2 rounded-pill bg-primary" />
            </RadixRadioGroup.Item>
            <span className="flex min-w-0 flex-col gap-xs">
              <Text as="span" variant="body2-medium">
                {option.label}
              </Text>
              {option.description === undefined ? null : (
                <Text as="span" variant="body3" tone="subtitle">
                  {option.description}
                </Text>
              )}
            </span>
          </label>
        ))}
      </RadixRadioGroup.Root>
    </div>
  );
}
