import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendJson } from './api-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendJson', () => {
  it('returns the parsed body for a success and sends JSON', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json({ hello: 'world' })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendJson('/api/x', { body: { a: 1 } })).resolves.toEqual({
      ok: true,
      data: { hello: 'world' },
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
      credentials: 'same-origin',
    });
  });

  it('turns a validation envelope into the first message per field', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        Response.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Request validation failed',
              details: { fieldErrors: { phone: ['Enter a 10-digit mobile number', 'second'] } },
            },
          },
          { status: 400 },
        ),
      ),
    );
    const result = await sendJson('/api/x', { body: {} });
    expect(result).toEqual({
      ok: false,
      failure: {
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        fieldErrors: { phone: 'Enter a 10-digit mobile number' },
        details: { fieldErrors: { phone: ['Enter a 10-digit mobile number', 'second'] } },
      },
    });
  });

  it('reports a network failure and an unexpected body without throwing', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    const offline = await sendJson('/api/x');
    expect(offline.ok ? null : offline.failure.code).toBe('NETWORK_ERROR');

    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html>', { status: 502 })));
    const unexpected = await sendJson('/api/x');
    expect(unexpected.ok ? null : unexpected.failure).toMatchObject({
      status: 502,
      code: 'UNEXPECTED_RESPONSE',
    });
  });

  it('treats 204 as success with no data', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 204 })));
    await expect(sendJson('/api/x', { method: 'DELETE' })).resolves.toEqual({
      ok: true,
      data: null,
    });
  });
});
