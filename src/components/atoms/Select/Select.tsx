'use client';

import { Select as RadixSelect } from 'radix-ui';
import { fieldControlClassNames } from '../field-control';
import { Icon } from '../Icon';
import type { SelectProps } from './select.types';

export function Select({
  options,
  placeholder,
  size = 'md',
  isInvalid = false,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...rootProps
}: SelectProps) {
  return (
    <RadixSelect.Root {...rootProps}>
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={isInvalid}
        className={`${fieldControlClassNames({ size, isInvalid })} inline-flex items-center justify-between gap-sm data-placeholder:text-text-muted`}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <Icon name="chevron-down" size="sm" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="z-50 overflow-hidden rounded-default border border-lowlight bg-white shadow-md">
          <RadixSelect.Viewport className="p-xs">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.isDisabled === true}
                className="relative flex cursor-pointer items-center gap-sm rounded-default py-sm pr-sm pl-xl text-body2 text-headings outline-none select-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-accent-light-1"
              >
                <RadixSelect.ItemIndicator className="absolute left-sm inline-flex text-primary">
                  <Icon name="check" size="xs" />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
