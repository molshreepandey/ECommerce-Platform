import { DomainError } from '@/lib/errors';

export class AddressNotFoundError extends DomainError {
  constructor() {
    super({ kind: 'NOT_FOUND', code: 'ADDRESS_NOT_FOUND', message: 'This address was not found.' });
  }
}
