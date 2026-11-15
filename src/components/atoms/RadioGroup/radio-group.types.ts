import type { ReactNode } from 'react';

export type RadioOption = Readonly<{
  value: string;
  label: ReactNode;
  description?: ReactNode;
  isDisabled?: boolean;
}>;

export type RadioGroupProps = Readonly<{
  name: string;
  label: string;
  options: readonly RadioOption[];
  value: string | null;
  onValueChange: (value: string) => void;
  isDisabled?: boolean;
}>;
