# Wave 4 walkthrough: category tree, tagging and product groups (admin)

Where each rule lives and how to see it. Read with TD-017.

## 1. Layers

| Layer          | Files                                                                            | Job                                                                |
| -------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Route handlers | `src/app/api/admin/{categories,tagging,product-groups}/**/route.ts`              | permission, parse id and body, call one service, respond           |
| Services       | `category.service.ts`, `tagging.service.ts`, `product-group.service.ts`          | permission again, transaction, locks, rules, audit, search outbox  |
| Pure rules     | `category-tree.ts` (paths, cycle and depth checks, labels), `group-rules.ts`     | unit-tested without a database                                     |
| Repositories   | `category.repository.ts`, `tagging.repository.ts`, `product-group.repository.ts` | queries only                                                       |
| Pages          | `src/app/admin/{categories,tagging,product-groups}/…`                            | server data inside `<Suspense>`, `TaxonomyAdmin` client components |

## 2. Rules worth explaining in a review

- **The tree is at most four levels deep, and products sit only on leaves.** A category with products
  cannot get children; tagging to a branch is refused.
- **No cycles.** A category cannot move under itself or a descendant. All tree writes share one advisory
  lock, so two opposite moves can never both pass the check (raced in tests).
- **A move or slug change rewrites the whole subtree** (paths and levels) in one statement, and queues every
  product below it for re-indexing.
- **Delete only an empty leaf.** Deactivating instead keeps products where they are and cascades down.
- **Tagging is all-or-nothing** for up to 100 products, and only products that really change get a new
  version, an audit row and an outbox row.
- **Groups:** at most 50 products, one group per product, order and swatch labels saved together against
  the exact current member list (a stale list is refused).
- **Products are always locked in id order**, so bulk tagging and group changes cannot deadlock.

## 3. Try it

1. Sign in to the admin site as `catalogue.manager@demo-store.test` (demo password, development only).
2. **Categories:** add a top-level category and a child, then move the child. The "New parent" list shows
   names such as "Ethnic › Kurtas". Categories that have products show no Delete or "Add under".
3. **Tagging:** select products in the queue, pick a leaf category and tag them; switch "Show" to tagged
   products to see their categories.
4. **Product groups:** create a group, find and add products, set swatch labels, reorder, save, reload.
5. Sign in as `support@demo-store.test`: everything is visible, with no write controls.
