import { Badge } from '@/components/atoms/Badge';
import { Card } from '@/components/atoms/Card';
import { Heading } from '@/components/atoms/Heading';
import { Text } from '@/components/atoms/Text';
import { formatDateTime } from '@/lib/date-format';

export type NotificationLogItem = Readonly<{
  id: string;
  sentAt: Date;
  channel: string;
  recipient: string;
  message: string;
}>;

// C38: the simulated SMS messages of one order, oldest first. Nothing was really sent (no SMS provider).
export function NotificationLog({
  notifications,
  headingId,
  headingLevel = 2,
}: Readonly<{
  notifications: readonly NotificationLogItem[];
  headingId: string;
  headingLevel?: 2 | 3;
}>) {
  return (
    <Card as="section" aria-labelledby={headingId}>
      <div className="flex flex-col gap-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <Heading level={headingLevel} variant="heading5" id={headingId}>
            Messages
          </Heading>
          <Badge tone="neutral">simulated</Badge>
        </div>
        {notifications.length === 0 ? (
          <Text variant="body3" tone="muted">
            No messages yet.
          </Text>
        ) : (
          <ol className="flex flex-col gap-sm">
            {notifications.map((notification) => (
              <li key={notification.id} className="flex flex-col gap-xs">
                <Text variant="body3">{notification.message}</Text>
                <Text variant="body4" tone="muted">
                  {formatDateTime(notification.sentAt)} · {notification.channel} to{' '}
                  {notification.recipient}
                </Text>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
