import { DomainError } from '@/lib/errors';
import {
  CatalogueConflictError,
  CatalogueUnprocessableError,
} from '@/modules/catalogue/catalogue.errors';

import { maximumGroupMembers } from './group-rules';

export const groupingErrors = {
  groupNotFound: () =>
    new DomainError({
      kind: 'NOT_FOUND',
      code: 'PRODUCT_GROUP_NOT_FOUND',
      message: 'This product group was not found.',
    }),
  groupFull: (memberCount: number) =>
    new CatalogueUnprocessableError(
      'GROUP_FULL',
      `A group can have at most ${maximumGroupMembers} products.`,
      { limit: maximumGroupMembers, memberCount },
    ),
  inAnotherGroup: (productIds: readonly string[]) =>
    new CatalogueConflictError(
      'PRODUCT_IN_ANOTHER_GROUP',
      'Some products already belong to another group. Remove them from it first.',
      { productIds },
    ),
  notInGroup: () =>
    new DomainError({
      kind: 'NOT_FOUND',
      code: 'PRODUCT_NOT_IN_GROUP',
      message: 'This product is not in this group.',
    }),
  staleMembers: () =>
    new CatalogueConflictError(
      'STALE_GROUP_MEMBERS',
      'The group’s products changed while you were editing. Reload and try again.',
    ),
} as const;
