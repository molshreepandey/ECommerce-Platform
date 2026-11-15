import { describe, expect, it } from 'vitest';
import { resolveReportRange } from './report.service';

const now = new Date('2026-11-14T20:00:00Z');

describe('resolveReportRange', () => {
  it('defaults to the last 30 IST days including today', () => {
    const range = resolveReportRange({}, now);
    expect(range.toDay).toBe('2026-11-15');
    expect(range.fromDay).toBe('2026-10-17');
    expect(range.from.toISOString()).toBe('2026-10-16T18:30:00.000Z');
    expect(range.to.toISOString()).toBe('2026-11-15T18:30:00.000Z');
  });

  it('treats the end day as inclusive', () => {
    const range = resolveReportRange({ from: '2026-11-01', to: '2026-11-01' }, now);
    expect(range.from.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(range.to.toISOString()).toBe('2026-11-01T18:30:00.000Z');
  });

  it('falls back to the default for a reversed or too long range', () => {
    expect(resolveReportRange({ from: '2026-11-10', to: '2026-11-01' }, now).fromDay).toBe(
      '2026-10-17',
    );
    expect(resolveReportRange({ from: '2020-01-01', to: '2026-11-01' }, now).fromDay).toBe(
      '2026-10-17',
    );
  });
});
