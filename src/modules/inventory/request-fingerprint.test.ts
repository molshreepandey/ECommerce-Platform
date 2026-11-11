import { describe, expect, it } from 'vitest';

import { receiveStockSchema } from './inventory.schema';
import { canonicalJson, fingerprintStockRequest } from './request-fingerprint';

const variantA = '0195f2a0-0000-7000-8000-000000000001';
const variantB = '0195f2a0-0000-7000-8000-000000000003';
const warehouse = '0195f2a0-0000-7000-8000-000000000002';

describe('canonicalJson', () => {
  it('sorts keys at every level, keeps array order and leaves out undefined properties', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: 'x' }, skipped: undefined })).toBe(
      '{"a":{"c":"x","d":[3,1]},"b":1}',
    );
    expect(canonicalJson({ a: { c: 'x', d: [3, 1] }, b: 1 })).toBe(
      canonicalJson({ b: 1, a: { d: [3, 1], c: 'x' } }),
    );
  });

  it('refuses values that are not plain JSON', () => {
    const notPlainJson: readonly [string, unknown][] = [
      ['Date', new Date(0)],
      ['Map', new Map()],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['bigint', 10n],
      ['function', () => 1],
    ];
    for (const [label, value] of notPlainJson) {
      expect(() => canonicalJson({ value }), label).toThrow(TypeError);
    }
  });
});

describe('fingerprintStockRequest', () => {
  const addInput = {
    variantId: variantA,
    warehouseId: warehouse,
    quantity: 5,
    reason: 'Found during count',
  };

  it('is a lower-case SHA-256 hex digest, the format the database accepts', () => {
    expect(fingerprintStockRequest('ADJUST_ADD', addInput)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable: pinned against an independent SHA-256 of the canonical form', () => {
    expect(fingerprintStockRequest('ADJUST_ADD', addInput)).toBe(
      '7a15d596c035190e7653c825e81633a164b090a5c28e10ae995e103256738d08',
    );
  });

  it('does not depend on key order', () => {
    const reordered = {
      reason: 'Found during count',
      quantity: 5,
      warehouseId: warehouse,
      variantId: variantA,
    };
    expect(fingerprintStockRequest('ADJUST_ADD', reordered)).toBe(
      fingerprintStockRequest('ADJUST_ADD', addInput),
    );
  });

  it('includes the operation type, so the same content for another operation differs', () => {
    const fingerprints = new Set(
      (['ADJUST_ADD', 'ADJUST_REMOVE', 'ADJUST_SET', 'RECEIPT'] as const).map((operation) =>
        fingerprintStockRequest(operation, addInput),
      ),
    );
    expect(fingerprints.size).toBe(4);
  });

  it('changes when the content changes', () => {
    expect(fingerprintStockRequest('ADJUST_ADD', { ...addInput, quantity: 6 })).not.toBe(
      fingerprintStockRequest('ADJUST_ADD', addInput),
    );
    expect(
      fingerprintStockRequest('ADJUST_ADD', { ...addInput, reason: 'Found during audit' }),
    ).not.toBe(fingerprintStockRequest('ADJUST_ADD', addInput));
  });

  it('gives the same receipt the same fingerprint whatever the line order or surrounding spaces', () => {
    const first = receiveStockSchema.parse({
      warehouseId: warehouse,
      supplierReference: 'INV-2026-114',
      lines: [
        { variantId: variantB, quantity: 4 },
        { variantId: variantA, quantity: 9 },
      ],
    });
    const second = receiveStockSchema.parse({
      warehouseId: warehouse,
      supplierReference: '  INV-2026-114 ',
      lines: [
        { variantId: variantA, quantity: 9 },
        { variantId: variantB, quantity: 4 },
      ],
    });
    expect(fingerprintStockRequest('RECEIPT', first)).toBe(
      fingerprintStockRequest('RECEIPT', second),
    );
  });
});
