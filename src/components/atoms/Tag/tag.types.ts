import type { ReactNode } from 'react';

export type TagProps = Readonly<{
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}>;
