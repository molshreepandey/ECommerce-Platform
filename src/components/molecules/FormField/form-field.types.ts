import type { InputProps } from '@/components/atoms/Input';

export type FormFieldProps = Omit<InputProps, 'id' | 'isInvalid' | 'aria-describedby'> & {
  label: string;
  name: string;
  error?: string | undefined;
  hint?: string | undefined;
};
