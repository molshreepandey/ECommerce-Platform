import { Card } from '@/components/atoms/Card';
import { Heading } from '@/components/atoms/Heading';
import { Text } from '@/components/atoms/Text';
import type { AuthLayoutProps } from './auth-layout.types';

export function AuthLayout({ title, description, footer, children }: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-lg py-2xl">
      <div className="flex w-full max-w-110 flex-col gap-lg">
        <Card padding="xl" elevation="raised">
          <div className="flex flex-col gap-lg">
            <div className="flex flex-col gap-xs">
              <Heading level={1} variant="heading2-5">
                {title}
              </Heading>
              {description === undefined ? null : <Text tone="subtitle">{description}</Text>}
            </div>
            {children}
          </div>
        </Card>
        {footer}
      </div>
    </main>
  );
}
