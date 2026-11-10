import { describe, expect, it } from 'vitest';

import { clientIpAddress } from '@/lib/client-ip';

function headersWith(...forwardedForLines: string[]): Headers {
  const headers = new Headers();
  for (const line of forwardedForLines) headers.append('x-forwarded-for', line);
  return headers;
}

describe('clientIpAddress with no trusted proxy (hop count 0)', () => {
  it('never trusts X-Forwarded-For', () => {
    expect(clientIpAddress(headersWith('203.0.113.9'), 0)).toBeNull();
    expect(clientIpAddress(headersWith('198.51.100.99, 203.0.113.9'), 0)).toBeNull();
  });
});

describe('clientIpAddress behind trusted proxies', () => {
  it('uses the only entry when the proxy overwrites the header', () => {
    expect(clientIpAddress(headersWith('203.0.113.7'), 1)).toBe('203.0.113.7');
  });

  it('ignores addresses the client put on the left and uses the one the proxy appended', () => {
    expect(clientIpAddress(headersWith('198.51.100.99, 203.0.113.7'), 1)).toBe('203.0.113.7');
    expect(clientIpAddress(headersWith('1.1.1.1, 8.8.8.8, 203.0.113.7'), 1)).toBe('203.0.113.7');
  });

  it('counts hops from the right when more than one proxy is trusted', () => {
    expect(clientIpAddress(headersWith('198.51.100.99, 203.0.113.7, 10.0.0.2'), 2)).toBe(
      '203.0.113.7',
    );
  });

  it('returns null, never the leftmost entry, when there are fewer entries than trusted hops', () => {
    expect(clientIpAddress(headersWith('203.0.113.7'), 2)).toBeNull();
    expect(clientIpAddress(headersWith('198.51.100.99, 203.0.113.7'), 3)).toBeNull();
  });

  it('returns null, never a neighbouring entry, when the selected entry is not an IP address', () => {
    expect(clientIpAddress(headersWith('203.0.113.7, unknown'), 1)).toBeNull();
    expect(clientIpAddress(headersWith('203.0.113.7, '), 1)).toBeNull();
    expect(clientIpAddress(headersWith('203.0.113.7, 198.51.100.4:5678'), 1)).toBeNull();
    expect(clientIpAddress(headersWith('203.0.113.7, not-an-ip, 10.0.0.2'), 2)).toBeNull();
  });

  it('returns null when the header is missing', () => {
    expect(clientIpAddress(headersWith(), 1)).toBeNull();
  });

  it('accepts IPv6 and surrounding whitespace', () => {
    expect(clientIpAddress(headersWith('198.51.100.99 ,  2001:db8::1 '), 1)).toBe('2001:db8::1');
  });

  it('reads the combined value when the header is sent on more than one line', () => {
    expect(clientIpAddress(headersWith('198.51.100.99', '203.0.113.7'), 1)).toBe('203.0.113.7');
  });

  it('fails closed for a hop count that is not a positive whole number', () => {
    expect(clientIpAddress(headersWith('203.0.113.7'), -1)).toBeNull();
    expect(clientIpAddress(headersWith('203.0.113.7'), 1.5)).toBeNull();
    expect(clientIpAddress(headersWith('203.0.113.7'), Number.NaN)).toBeNull();
  });
});
