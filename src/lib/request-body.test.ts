import { describe, expect, it } from 'vitest';

import { readTextWithin } from './request-body';

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
