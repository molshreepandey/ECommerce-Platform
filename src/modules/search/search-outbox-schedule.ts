import { after } from 'next/server';

// Called whenever a change queues outbox rows. Inside a request it drains after the response is sent
// (plan §10B); elsewhere (scripts, tests) after() is unavailable and `npm run search:sync` does the work.
// The drain is imported lazily because it depends on the outbox repository, which calls this function.
export function scheduleSearchOutboxDrain(): void {
  try {
    after(async () => {
      const { drainSearchOutboxInBackground } = await import('./search-outbox.service');
      await drainSearchOutboxInBackground();
    });
  } catch {
    // Not inside a request scope.
  }
}
