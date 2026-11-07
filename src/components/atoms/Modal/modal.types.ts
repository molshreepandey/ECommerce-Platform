import type { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

export type ModalSize = 'sm' | 'md' | 'lg';

export type ModalProps = Pick<RadixDialog.DialogProps, 'open' | 'defaultOpen' | 'onOpenChange'> & {
  title: string;
  description?: string;
  trigger?: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  children?: ReactNode;
};
