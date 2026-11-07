import { describe, expect, it } from 'vitest';

import { checkRequestOrigin, OriginNotAllowedError } from '@/lib/request-origin';

const surfaces = {
  store: { hosts: ['store.localhost:3000'], publicOrigin: 'http://store.localhost:3000' },
  admin: { hosts: ['admin.localhost:3000'], publicOrigin: 'http://admin.localhost:3000' },
};

function check(method: string, originHeader: string | null, surface: string | null = 'store') {
  return checkRequestOrigin({ method, originHeader, surface }, surfaces);
}

describe('checkRequestOrigin', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('does not require an Origin for %s', (method) => {
    expect(check(method, null)).toEqual({ allowed: true });
  });

  it('allows a same-site POST', () => {
    expect(check('POST', 'http://store.localhost:3000')).toEqual({ allowed: true });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])('requires an Origin for %s', (method) => {
    expect(check(method, null)).toEqual({ allowed: false, reason: 'ORIGIN_MISSING' });
  });

  it.each([
    ['another site', 'https://evil.example.com'],
    ['the other surface', 'http://admin.localhost:3000'],
    ['a lookalike prefix', 'http://store.localhost:3000.evil.example.com'],
    ['the literal "null" origin', 'null'],
  ])('rejects a POST from %s', (_label, originHeader) => {
    expect(check('POST', originHeader)).toEqual({ allowed: false, reason: 'ORIGIN_MISMATCH' });
  });

  it('rejects a state-changing request when the surface is unknown', () => {
    expect(check('POST', 'http://store.localhost:3000', null)).toEqual({
      allowed: false,
      reason: 'SURFACE_UNKNOWN',
    });
  });

  it('maps a rejection to a 403 with a stable error code', () => {
    const error = new OriginNotAllowedError('ORIGIN_MISMATCH');
    expect(error.httpStatus).toBe(403);
    expect(error.toEnvelope().error.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});
