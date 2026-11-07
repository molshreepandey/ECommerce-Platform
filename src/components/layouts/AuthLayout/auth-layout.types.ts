import type { ReactNode } from 'react';

export type AuthLayoutProps = Readonly<{
  title: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
}>;
