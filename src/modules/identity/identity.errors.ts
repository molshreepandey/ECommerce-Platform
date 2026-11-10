import { DomainError } from '@/lib/errors';

export class UnauthenticatedError extends DomainError {
  constructor() {
    super({
      kind: 'UNAUTHENTICATED',
      code: 'UNAUTHENTICATED',
      message: 'Please sign in to continue.',
    });
  }
}

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super({
      kind: 'UNAUTHENTICATED',
      code: 'INVALID_CREDENTIALS',
      message: 'The email or password is incorrect.',
    });
  }
}

export class WrongAccountTypeError extends DomainError {
  constructor() {
    super({
      kind: 'FORBIDDEN',
      code: 'WRONG_ACCOUNT_TYPE',
      message: 'This account cannot use this site.',
    });
  }
}

export class PermissionDeniedError extends DomainError {
  constructor(permissionCode: string) {
    super({
      kind: 'FORBIDDEN',
      code: 'PERMISSION_DENIED',
      message: 'You do not have permission to do this.',
      details: { requiredPermission: permissionCode },
    });
  }
}

export class EmailAlreadyRegisteredError extends DomainError {
  constructor() {
    super({
      kind: 'CONFLICT',
      code: 'EMAIL_ALREADY_REGISTERED',
      message: 'An account with this email already exists.',
    });
  }
}

export class PhoneAlreadyRegisteredError extends DomainError {
  constructor() {
    super({
      kind: 'CONFLICT',
      code: 'PHONE_ALREADY_REGISTERED',
      message: 'An account with this phone number already exists.',
    });
  }
}
