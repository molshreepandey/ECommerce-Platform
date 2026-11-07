'use client';

import { Button } from '@/components/atoms/Button';
import { Flexbox } from '@/components/atoms/Flexbox';
import { InlineAlert } from '@/components/atoms/InlineAlert';

type ErrorPageProps = Readonly<{
  error: unknown;
  retry: () => void;
}>;

function readErrorReference(error: unknown): string | null {
  if (error instanceof Error && 'digest' in error && typeof error.digest === 'string') {
    return error.digest;
  }
  return null;
}

export default function ErrorPage({ error, retry }: ErrorPageProps) {
  const errorReference = readErrorReference(error);
  return (
    <Flexbox as="main" direction="column" padding="xl">
      <InlineAlert
        tone="danger"
        title="Something went wrong"
        action={
          <Button appearance="default" size="sm" onClick={retry}>
            Try again
          </Button>
        }
      >
        {errorReference === null
          ? 'Please try again in a moment.'
          : `Please try again in a moment. Reference: ${errorReference}`}
      </InlineAlert>
    </Flexbox>
  );
}
