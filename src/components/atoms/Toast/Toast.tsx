'use client';

import { cva } from 'class-variance-authority';
import { Toast as RadixToast } from 'radix-ui';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { focusRingClassNames } from '../focus-ring';
import { Icon, type IconName } from '../Icon';
import type { ToastApi, ToastMessage, ToastProviderProps, ToastTone } from './toast.types';

const ToastContext = createContext<ToastApi | null>(null);

const toastClassNames = cva(
  'flex items-start gap-md rounded-card border border-l-4 bg-white p-md shadow-md',
  {
    variants: {
      tone: {
        info: 'border-strokes border-l-primary',
        success: 'border-strokes border-l-status-green',
        warning: 'border-strokes border-l-status-yellow',
        danger: 'border-strokes border-l-status-red',
      },
    },
  },
);

const toastIconByTone: Readonly<Record<ToastTone, IconName>> = {
  info: 'info',
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
};

export function ToastProvider({ children }: ToastProviderProps) {
  const [toastMessages, setToastMessages] = useState<readonly ToastMessage[]>([]);

  const showToast = useCallback<ToastApi['showToast']>((toastInput) => {
    const toastMessage: ToastMessage = { ...toastInput, toastId: crypto.randomUUID() };
    setToastMessages((currentMessages) => [...currentMessages, toastMessage]);
  }, []);

  const dismissToast = useCallback((toastId: string) => {
    setToastMessages((currentMessages) =>
      currentMessages.filter((toastMessage) => toastMessage.toastId !== toastId),
    );
  }, []);

  const toastApi = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext value={toastApi}>
      <RadixToast.Provider swipeDirection="right">
        {children}
        {toastMessages.map((toastMessage) => (
          <ToastItem
            key={toastMessage.toastId}
            toastMessage={toastMessage}
            onDismiss={dismissToast}
          />
        ))}
        <RadixToast.Viewport className="fixed right-0 bottom-0 z-50 flex w-full max-w-96 flex-col gap-sm p-lg outline-none" />
      </RadixToast.Provider>
    </ToastContext>
  );
}

type ToastItemProps = Readonly<{
  toastMessage: ToastMessage;
  onDismiss: (toastId: string) => void;
}>;

function ToastItem({ toastMessage, onDismiss }: ToastItemProps) {
  const tone = toastMessage.tone ?? 'info';
  return (
    <RadixToast.Root
      className={toastClassNames({ tone })}
      onOpenChange={(isOpen) => {
        if (!isOpen) onDismiss(toastMessage.toastId);
      }}
    >
      <Icon name={toastIconByTone[tone]} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-xs">
        <RadixToast.Title className="text-body2-medium text-headings">
          {toastMessage.title}
        </RadixToast.Title>
        {toastMessage.description === undefined ? null : (
          <RadixToast.Description className="text-body3 text-subtitles">
            {toastMessage.description}
          </RadixToast.Description>
        )}
      </div>
      <RadixToast.Close
        aria-label="Dismiss notification"
        className={`inline-flex shrink-0 rounded-default text-subtitles hover:text-headings ${focusRingClassNames}`}
      >
        <Icon name="close" size="sm" />
      </RadixToast.Close>
    </RadixToast.Root>
  );
}

export function useToast(): ToastApi {
  const toastApi = useContext(ToastContext);
  if (toastApi === null) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return toastApi;
}
