import { DomainError } from '@/lib/errors';
import {
  CatalogueConflictError,
  CatalogueUnprocessableError,
} from '@/modules/catalogue/catalogue.errors';

export const taxonomyErrors = {
  tooManyToRecategorise: (productCount: number, maximum: number) =>
    new CatalogueUnprocessableError(
      'TOO_MANY_PRODUCTS',
      `This category has more than ${String(maximum)} products to move at once.`,
      { productCount, maximum },
    ),
  categoryNotFound: () =>
    new DomainError({
      kind: 'NOT_FOUND',
      code: 'CATEGORY_NOT_FOUND',
      message: 'This category was not found.',
    }),
  slugTaken: () =>
    new CatalogueConflictError('CATEGORY_SLUG_TAKEN', 'A category with this slug already exists.'),
  moveCycle: () =>
    new CatalogueConflictError(
      'CATEGORY_MOVE_CYCLE',
      'A category cannot move under itself or one of its own subcategories.',
    ),
  tooDeep: () =>
    new CatalogueUnprocessableError(
      'CATEGORY_TOO_DEEP',
      'The category tree can be at most four levels deep.',
    ),
  hasProducts: (productCount: number) =>
    new CatalogueConflictError(
      'CATEGORY_HAS_PRODUCTS',
      'Products are tagged to this category. Move them to another category first.',
      { productCount },
    ),
  hasChildren: (childCount: number) =>
    new CatalogueConflictError(
      'CATEGORY_HAS_CHILDREN',
      'This category has subcategories. Delete or move them first.',
      { childCount },
    ),
  parentInactive: () =>
    new CatalogueUnprocessableError(
      'PARENT_CATEGORY_INACTIVE',
      'The parent category is inactive. Activate it first.',
    ),
  notLeaf: () =>
    new CatalogueUnprocessableError(
      'CATEGORY_NOT_LEAF',
      'Products can only be tagged to a category without subcategories.',
    ),
  inactive: () =>
    new CatalogueUnprocessableError(
      'CATEGORY_INACTIVE',
      'This category is inactive. Choose an active category.',
    ),
  productsNotFound: (productIds: readonly string[]) =>
    new CatalogueUnprocessableError(
      'PRODUCTS_NOT_FOUND',
      'Some of the chosen products do not exist.',
      { productIds },
    ),
  productsArchived: (productIds: readonly string[]) =>
    new CatalogueConflictError(
      'PRODUCTS_ARCHIVED',
      'Archived products cannot be changed. Restore them first.',
      { productIds },
    ),
} as const;
