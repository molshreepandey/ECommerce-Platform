import { describe, expect, it } from 'vitest';

import { probeWithTimeout, summarizeHealth } from '@/lib/health';

describe('summarizeHealth', () => {
  it('is ok with 200 when every dependency is up', () => {
    expect(summarizeHealth({ postgres: 'up', elasticsearch: 'up', redis: 'up' })).toEqual({
      status: 'ok',
      httpStatus: 200,
      checks: {
        postgres: { status: 'up', critical: true },
        elasticsearch: { status: 'up', critical: false },
        redis: { status: 'up', critical: false },
      },
    });
  });

  it('is degraded with 200 when only Elasticsearch is down', () => {
    const report = summarizeHealth({ postgres: 'up', elasticsearch: 'down', redis: 'up' });
    expect(report.status).toBe('degraded');
    expect(report.httpStatus).toBe(200);
    expect(report.checks.elasticsearch).toEqual({ status: 'down', critical: false });
  });

  it('is unavailable with 503 when Postgres is down', () => {
    const report = summarizeHealth({ postgres: 'down', elasticsearch: 'up', redis: 'up' });
    expect(report.status).toBe('unavailable');
    expect(report.httpStatus).toBe(503);
    expect(report.checks.postgres).toEqual({ status: 'down', critical: true });
  });

  it('is unavailable with 503 when Postgres and Elasticsearch are both down', () => {
    const report = summarizeHealth({ postgres: 'down', elasticsearch: 'down', redis: 'down' });
    expect(report.status).toBe('unavailable');
    expect(report.httpStatus).toBe(503);
  });

  it('is degraded with 200 when only Redis is down', () => {
    const report = summarizeHealth({ postgres: 'up', elasticsearch: 'up', redis: 'down' });
    expect(report.status).toBe('degraded');
    expect(report.httpStatus).toBe(200);
    expect(report.checks.redis).toEqual({ status: 'down', critical: false });
  });

  it('never reports ok while any dependency is down, and 503 only when Postgres is down', () => {
    const statuses = ['up', 'down'] as const;
    for (const postgres of statuses) {
      for (const elasticsearch of statuses) {
        for (const redis of statuses) {
          const report = summarizeHealth({ postgres, elasticsearch, redis });
          const anyDown = [postgres, elasticsearch, redis].includes('down');
          expect(report.status === 'ok').toBe(!anyDown);
          expect(report.httpStatus).toBe(postgres === 'down' ? 503 : 200);
        }
      }
    }
  });
});

describe('probeWithTimeout', () => {
  it('reports up when the probe resolves true in time', async () => {
    await expect(probeWithTimeout(() => Promise.resolve(true), 100)).resolves.toBe('up');
  });

  it('reports down when the probe resolves false', async () => {
    await expect(probeWithTimeout(() => Promise.resolve(false), 100)).resolves.toBe('down');
  });

  it('reports down when the probe throws', async () => {
    await expect(
      probeWithTimeout(() => Promise.reject(new Error('connection refused')), 100),
    ).resolves.toBe('down');
  });

  it('reports down when the probe hangs past the timeout', async () => {
    const neverSettles = () => new Promise<boolean>(() => undefined);
    const startedAt = performance.now();
    await expect(probeWithTimeout(neverSettles, 50)).resolves.toBe('down');
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
