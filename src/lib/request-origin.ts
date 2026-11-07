import type { AppConfig } from '@/lib/config';
import { DomainError } from '@/lib/errors';
import type { Surface } from '@/lib/host-routing';

const stateChangingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type OriginCheckResult =
  | { allowed: true }
  | { allowed: false; reason: 'ORIGIN_MISSING' | 'ORIGIN_MISMATCH' | 'SURFACE_UNKNOWN' };

export function isSurface(value: string | null): value is Surface {
  return value === 'store' || value === 'admin';
}

export function checkRequestOrigin(
  request: { method: string; originHeader: string | null; surface: string | null },
  surfaces: AppConfig['surfaces'],
): OriginCheckResult {
  if (!stateChangingMethods.has(request.method.toUpperCase())) return { allowed: true };
  if (!isSurface(request.surface)) return { allowed: false, reason: 'SURFACE_UNKNOWN' };
  if (request.originHeader === null) return { allowed: false, reason: 'ORIGIN_MISSING' };
  return request.originHeader === surfaces[request.surface].publicOrigin
    ? { allowed: true }
    : { allowed: false, reason: 'ORIGIN_MISMATCH' };
}

export class OriginNotAllowedError extends DomainError {
  constructor(reason: Exclude<OriginCheckResult, { allowed: true }>['reason']) {
    super({
      kind: 'FORBIDDEN',
      code: 'ORIGIN_NOT_ALLOWED',
      message: 'This request must come from the same site.',
      details: { reason },
    });
  }
}
