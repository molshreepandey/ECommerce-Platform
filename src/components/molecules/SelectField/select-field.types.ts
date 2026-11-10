import type { SelectOption } from '@/components/atoms/Select';

export type SelectFieldProps = Readonly<{
  label: string;
  name: string;
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  error?: string | undefined;
  hint?: string | undefined;
  disabled?: boolean;
}>;
