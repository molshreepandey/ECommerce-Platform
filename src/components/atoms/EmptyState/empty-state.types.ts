import type { ReactNode } from 'react';
import type { IconName } from '../Icon';

export type EmptyStateProps = Readonly<{
  icon?: IconName;
  title: string;
  headingLevel?: 1 | 2;
  description?: string;
  action?: ReactNode;
}>;
