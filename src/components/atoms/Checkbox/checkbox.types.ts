import type { Checkbox as RadixCheckbox } from 'radix-ui';
import type { ReactNode } from 'react';

export type CheckboxProps = Omit<
  RadixCheckbox.CheckboxProps,
  'className' | 'style' | 'children' | 'asChild'
> & {
  label?: ReactNode;
};
