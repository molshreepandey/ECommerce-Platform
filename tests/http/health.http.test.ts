import { describe, expect, it } from 'vitest';

import { adminHost, getPage, storeHost } from './app-server';

describe('GET /api/health with every dependency running', () => {
  it.each([storeHost, adminHost])('reports ok with per-dependency detail on %s', async (host) => {
    const response = await getPage(host, '/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(response.body).toEqual({
      status: 'ok',
      checks: {
        postgres: { status: 'up', critical: true },
        elasticsearch: { status: 'up', critical: false },
        redis: { status: 'up', critical: false },
      },
    });
  });
});
