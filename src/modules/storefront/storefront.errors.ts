import { DomainError } from '@/lib/errors';

export const storefrontErrors = {
  categoryNotFound: () =>
    new DomainError({
      kind: 'NOT_FOUND',
      code: 'CATEGORY_NOT_FOUND',
      message: 'This category was not found.',
    }),
  productNotFound: () =>
    new DomainError({
      kind: 'NOT_FOUND',
      code: 'PRODUCT_NOT_FOUND',
      message: 'This product was not found.',
    }),
};
