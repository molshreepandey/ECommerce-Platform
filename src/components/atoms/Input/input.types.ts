import type { ComponentPropsWithRef } from 'react';
import type { FieldControlSize } from '../field-control';

export type InputProps = Omit<ComponentPropsWithRef<'input'>, 'className' | 'style' | 'size'> & {
  size?: FieldControlSize;
  isInvalid?: boolean;
};
