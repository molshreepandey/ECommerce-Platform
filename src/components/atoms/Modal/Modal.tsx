'use client';

import { cva } from 'class-variance-authority';
import { Dialog as RadixDialog } from 'radix-ui';
import { useRef } from 'react';
import { focusRingClassNames } from '../focus-ring';
import { Icon } from '../Icon';
import type { ModalProps } from './modal.types';

const modalContentClassNames = cva(
  'fixed inset-0 z-50 m-auto flex h-fit max-h-11/12 w-11/12 flex-col gap-lg overflow-y-auto rounded-card bg-white p-lg shadow-lg md:p-xl',
  {
    variants: {
      size: { sm: 'max-w-96', md: 'max-w-120', lg: 'max-w-180' },
    },
  },
);

export function Modal({
  title,
  description,
  trigger,
  footer,
  size = 'md',
  children,
  ...dialogRootProps
}: ModalProps) {
  // Radix returns focus only to a Dialog.Trigger; most dialogs here open from state, so the element that
  // had focus when the dialog opened gets it back on close (WCAG 2.4.3), if it is still on the page.
  const returnFocusTo = useRef<HTMLElement | null>(null);
  return (
    <RadixDialog.Root {...dialogRootProps}>
      {trigger === undefined ? null : <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-headings/60" />
        <RadixDialog.Content
          onOpenAutoFocus={() => {
            returnFocusTo.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocusTo.current;
            if (trigger !== undefined || target === null || !target.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
          className={modalContentClassNames({ size })}
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
        >
          <div className="flex items-start justify-between gap-md">
            <div className="flex min-w-0 flex-col gap-xs">
              <RadixDialog.Title className="text-heading3 text-headings">{title}</RadixDialog.Title>
              {description === undefined ? null : (
                <RadixDialog.Description className="text-body2 text-subtitles">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              className={`inline-flex size-8 shrink-0 items-center justify-center rounded-default text-subtitles hover:bg-strokes ${focusRingClassNames}`}
            >
              <Icon name="close" size="sm" />
            </RadixDialog.Close>
          </div>
          {children}
          {footer === undefined ? null : (
            <div className="flex flex-wrap justify-end gap-sm">{footer}</div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
