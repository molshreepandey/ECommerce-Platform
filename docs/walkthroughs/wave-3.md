# Wave 3 walkthrough: the modular catalogue (admin)

How a product gets from "nothing" to "active", and where each rule lives. Read with TD-016.

## 1. The idea: product types are data, not code

A product type (Apparel, Footwear) owns **attribute definitions**. Each definition says what a product of
that type must or may have: a code, a data type (text, number, yes/no, single or multiple choice), a scope
(a product attribute such as fabric, or a **variant option** such as size), and whether it is required.

`attribute-validation.ts` turns a type's definitions into a strict Zod schema at runtime, so a brand-new type
needs no code change: the admin form (`AttributeFields`) and the server validation both come from the same
definitions. Errors point at the field, for example `attributes.fabric: Choose a value`.

## 2. Layers

| Layer          | Files                                                                                                               | Job                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Route handlers | `src/app/api/admin/**/route.ts`                                                                                     | permission, parse id / query / body, call one service, respond        |
| Services       | `src/modules/catalogue/*.service.ts`                                                                                | permission again, transaction, locks, rules, audit, search outbox     |
| Pure rules     | `attribute-validation.ts`, `product-lifecycle.ts`, `variant-generation.ts`, `image-url.ts`, `product-list-query.ts` | unit-tested without a database                                        |
| Repositories   | `*.repository.ts`                                                                                                   | queries only                                                          |
| Pages          | `src/app/admin/{product-types,brands,products}/…`                                                                   | server-rendered data inside `<Suspense>`, client components for forms |

## 3. Rules worth explaining in a review

- **An ACTIVE product always has an active variant.** Activation (422 without one) and variant archive or
  deactivate (409 for the last one) both lock the product row first, so they cannot interleave. Tests race
  them on purpose.
- **Optimistic locking.** Every product edit sends the `version` it read; the update only matches that
  version. Two people editing at once: one wins, the other sees "Someone else changed this product".
- **Archiving is only a status change.** Stock, reservations, movements, orders, carts, reviews and
  collection links are untouched; a test compares those rows byte for byte.
- **Images belong to their own product's variants**, enforced by a composite foreign key.
- **Every change writes its audit row and a search-outbox row in the same transaction.** If either fails,
  the change rolls back (tested by forcing a failure).
- **Fixed after creation:** SKU, variant options, a product's type, an attribute's code, type and scope. A
  slug changes only while the product is a draft.

## 4. Try it

1. Sign in at http://admin.localhost:3000/login as `catalogue.manager@demo-store.test`.
2. Product types → New product type → add a required single-choice attribute and a variant option.
3. Brands → New brand.
4. Products → New product → pick the type: the form shows its attributes.
5. In the product: Generate variants, Add image, Activate product.
6. Sign in as `support@demo-store.test`: the same pages are read-only.

Tests: `npm run test:integration` (service rules), `npm run test:http` and `npm run test:e2e` against
`npm run start:test`.
