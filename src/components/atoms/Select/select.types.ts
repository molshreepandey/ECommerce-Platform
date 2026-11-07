import type { Select as RadixSelect } from 'radix-ui';
import type { FieldControlSize } from '../field-control';

export type SelectOption = Readonly<{
  value: string;
  label: string;
  isDisabled?: boolean;
}>;

export type SelectProps = Omit<RadixSelect.SelectProps, 'children' | 'dir'> & {
  options: readonly SelectOption[];
  placeholder?: string;
  size?: FieldControlSize;
  isInvalid?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
};
