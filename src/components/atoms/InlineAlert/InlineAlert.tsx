import { cva } from 'class-variance-authority';
import { Icon, type IconName } from '../Icon';
import type { InlineAlertProps, InlineAlertTone } from './inline-alert.types';

const inlineAlertClassNames = cva('flex items-start gap-md rounded-card border p-md', {
  variants: {
    tone: {
      info: 'border-accent-light-2 bg-accent-light-1',
      success: 'border-green-100 bg-green-50',
      warning: 'border-yellow-100 bg-status-warning-1',
      danger: 'border-red-100 bg-red-50',
    },
  },
});

const inlineAlertIconClassNames = cva('inline-flex shrink-0', {
  variants: {
    tone: {
      info: 'text-primary',
      success: 'text-status-green',
      warning: 'text-status-orange',
      danger: 'text-red-500',
    },
  },
});

const inlineAlertIconByTone: Readonly<Record<InlineAlertTone, IconName>> = {
  info: 'info',
  success: 'circle-check',
  warning: 'triangle-alert',
  danger: 'circle-alert',
};

export function InlineAlert({ tone, title, action, children }: InlineAlertProps) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={inlineAlertClassNames({ tone })}>
      <span className={inlineAlertIconClassNames({ tone })}>
        <Icon name={inlineAlertIconByTone[tone]} size="md" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-xs text-body2 text-headings">
        {title === undefined ? null : <p className="text-body2-medium">{title}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}
