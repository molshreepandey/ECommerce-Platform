'use client';

import { Checkbox as RadixCheckbox } from 'radix-ui';
import { focusRingClassNames } from '../focus-ring';
import { Icon } from '../Icon';
import type { CheckboxProps } from './checkbox.types';

const checkboxBoxClassNames = [
  'inline-flex size-4 shrink-0 items-center justify-center rounded-default border border-lowlight-2 bg-white text-white',
  'aria-checked:border-primary aria-checked:bg-primary disabled:cursor-not-allowed disabled:opacity-60',
  focusRingClassNames,
].join(' ');

export function Checkbox({ label, ...checkboxAttributes }: CheckboxProps) {
  const checkboxControl = (
    <RadixCheckbox.Root {...checkboxAttributes} className={checkboxBoxClassNames}>
      <RadixCheckbox.Indicator className="inline-flex">
        <Icon name="check" size="xs" />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
  if (label === undefined) {
    return checkboxControl;
  }
  return (
    <label className="inline-flex cursor-pointer items-center gap-sm text-body2 text-headings">
      {checkboxControl}
      <span>{label}</span>
    </label>
  );
}
