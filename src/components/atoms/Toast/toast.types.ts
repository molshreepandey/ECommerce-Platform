import type { ReactNode } from 'react';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export type ToastInput = Readonly<{
  title: string;
  description?: string;
  tone?: ToastTone;
}>;

export type ToastMessage = ToastInput & Readonly<{ toastId: string }>;

export type ToastApi = Readonly<{
  showToast: (toastInput: ToastInput) => void;
}>;

export type ToastProviderProps = Readonly<{ children: ReactNode }>;
