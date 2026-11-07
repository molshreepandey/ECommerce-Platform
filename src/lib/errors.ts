export type DomainErrorKind =
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE'
  | 'RATE_LIMITED';

export const httpStatusByErrorKind: Record<DomainErrorKind, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
};

export interface ErrorEnvelope {
  error: { code: string; message: string; details: unknown };
}

export interface DomainErrorInput {
  kind: DomainErrorKind;
  code: string;
  message: string;
  details?: unknown;
}

export class DomainError extends Error {
  readonly kind: DomainErrorKind;
  readonly code: string;
  readonly details: unknown;

  constructor(input: DomainErrorInput) {
    super(input.message);
    this.name = new.target.name;
    this.kind = input.kind;
    this.code = input.code;
    this.details = input.details ?? null;
  }

  get httpStatus(): number {
    return httpStatusByErrorKind[this.kind];
  }

  responseHeaders(): Record<string, string> {
    return {};
  }

  toEnvelope(): ErrorEnvelope {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export function buildErrorEnvelope(
  code: string,
  message: string,
  details: unknown = null,
): ErrorEnvelope {
  return { error: { code, message, details } };
}
