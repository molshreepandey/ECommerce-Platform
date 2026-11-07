import type { ReactNode } from 'react';

export type InlineAlertTone = 'info' | 'success' | 'warning' | 'danger';

export type InlineAlertProps = Readonly<{
  tone: InlineAlertTone;
  title?: string;
  action?: ReactNode;
  children?: ReactNode;
}>;
