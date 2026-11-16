import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DomainError } from './errors';
import { maximumJsonBodyBytes, parseJsonBody, readTextWithin } from './request-body';

function streamOf(parts: readonly string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    },
  });
}

// Node needs `duplex: 'half'` to send a stream body; the DOM RequestInit type does not list it yet.
function streamRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  const init = { method: 'POST', body, headers, duplex: 'half' };
  return new Request('http://localhost/', init);
}

describe('readTextWithin (L1)', () => {
  it('returns a body within the limit', async () => {
    const request = new Request('http://localhost/', { method: 'POST', body: '{"a":1}' });
    expect(await readTextWithin(request, 64)).toBe('{"a":1}');
  });

  it('refuses a declared Content-Length above the limit without reading the body', async () => {
    const request = streamRequest(streamOf(['x'.repeat(1000)]), { 'content-length': '1000' });
    expect(await readTextWithin(request, 64)).toBeNull();
    expect(request.bodyUsed).toBe(false);
  });

  it('stops reading a chunked body as soon as it passes the limit', async () => {
    const request = streamRequest(streamOf(['x'.repeat(40), 'y'.repeat(40), 'z'.repeat(40)]));
    expect(await readTextWithin(request, 64)).toBeNull();
  });

  it('keeps multi-byte characters split across chunks intact', async () => {
    const bytes = new TextEncoder().encode('₹799');
    const request = streamRequest(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 2));
          controller.enqueue(bytes.slice(2));
          controller.close();
        },
      }),
    );
    expect(await readTextWithin(request, 64)).toBe('₹799');
  });
});

describe('parseJsonBody (API-7)', () => {
  const schema = z.object({ name: z.string() });
  const errorCode = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => (error instanceof DomainError ? error.code : String(error)),
    );

  it('parses and validates a body within the limit', async () => {
    const request = new Request('http://localhost/', { method: 'POST', body: '{"name":"Kurta"}' });
    expect(await parseJsonBody(request, schema)).toEqual({ name: 'Kurta' });
  });

  it('refuses malformed and empty bodies as INVALID_JSON', async () => {
    for (const body of ['{"name":', '']) {
      const request = new Request('http://localhost/', { method: 'POST', body });
      expect(await errorCode(parseJsonBody(request, schema))).toBe('INVALID_JSON');
    }
  });

  it('refuses a body over the limit without buffering all of it', async () => {
    const chunk = 'x'.repeat(1024 * 1024);
    const parts = Array.from({ length: maximumJsonBodyBytes / chunk.length + 1 }, () => chunk);
    const request = streamRequest(streamOf(parts));
    expect(await errorCode(parseJsonBody(request, schema))).toBe('BODY_TOO_LARGE');
  });
});
