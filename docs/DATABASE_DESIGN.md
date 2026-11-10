# Database design

Full diagram: `docs/er-diagram.svg` (generated from `prisma/schema.prisma` with `npm run docs:erd`).
Migrations: `prisma/migrations/`. This page explains the rules that protect data.

## Principles (plan §9.1)

- Primary keys are `uuid` with `DEFAULT uuidv7()` (time-ordered, index friendly); human-facing numbers
  (`order_number`, `sku`, `awb_number`) are separate unique columns.
- Money is an integer number of paise in columns ending `_paise`; no floating point.
- Things that grow are rows (product types, roles, permissions, warehouses, couriers, settings); internal
  state machines are Postgres enums.
- Foreign keys everywhere with `ON DELETE RESTRICT`; no hard deletes of business data.
- Every query pattern has an index (plan §9.4); all 40 were verified present in the database.

## Constraints that stop bad data at the database

| Constraint                                                                                                           | Protects                                                                                                         | Proven by                                         |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `inventory_levels_quantities_check`: on hand ≥ 0, reserved ≥ 0, reserved ≤ on hand                                   | stock never negative or over-reserved                                                                            | `tests/integration/database-constraints.test.ts`  |
| generated `available_quantity = on_hand − reserved`                                                                  | availability can never be written inconsistently                                                                 | same                                              |
| guarded `UPDATE … WHERE on_hand − reserved >= qty`                                                                   | reservations under concurrency (20 parallel against 7 units → exactly 7)                                         | same                                              |
| `product_variants_price_check`: 0 < price ≤ MRP                                                                      | pricing errors                                                                                                   | same                                              |
| `categories_level_check`, `categories_root_level_check`                                                              | category tree depth 1–4                                                                                          | same                                              |
| partial unique `customer_addresses_one_default_per_customer`                                                         | one default address                                                                                              | same                                              |
| `customer_addresses_pincode_check`                                                                                   | 6-digit Indian pincode                                                                                           | same                                              |
| unique `orders(customer_id, idempotency_key)`                                                                        | duplicate checkout                                                                                               | Wave 8 tests                                      |
| unique `(courier_partner_id, provider_event_id)` on webhook receipts                                                 | duplicate webhooks                                                                                               | Wave 9 tests                                      |
| `rate_limit_counters` primary key `(bucket_key, window_started_at)`                                                  | atomic rate-limit counting                                                                                       | `tests/integration/rate-limit.test.ts`            |
| composite FK `product_media(product_id, variant_id)` → `product_variants(product_id, id)`, ON UPDATE/DELETE RESTRICT | an image can only belong to a variant of its own product; a variant with images can be neither deleted nor moved | `tests/integration/catalogue-constraints.test.ts` |
| `products_archived_at_check`: `status = ARCHIVED` exactly when `archived_at` is set                                  | one consistent product lifecycle                                                                                 | same                                              |
| `products.version` (≥ 0)                                                                                             | optimistic locking for admin edits (`UPDATE … WHERE version = n`)                                                | same                                              |
| slug, type-code, attribute-code and SKU format checks                                                                | clean URLs and keys; SKUs upper-case, at most 64 characters                                                      | same                                              |
| `attribute_definitions_allowed_values_check`, `…_variant_option_enum_check`                                          | choice attributes always have allowed values; variant options are single-choice                                  | same                                              |
| `product_media_position_check`, `product_media_alt_text_check`                                                       | image order from 0; every image has alt text                                                                     | same                                              |

Every catalogue foreign key is `ON DELETE RESTRICT`, and the project has no triggers: archiving a product or
variant is a status change only, so stock rows, reservations, movements, order lines, cart lines, reviews
and collection links are never deleted or modified by it (TD-016).

## Integrity requirements for later waves (mandatory)

- **Wave 8, before order placement:** add the composite FK `order_items(product_id, variant_id)` →
  `product_variants(product_id, id)` (the unique key already exists). Re-run the read-only check first; on
  2026-11-10 it found 0 mismatched rows in development.
- **Wave 8, before order placement:** order items must snapshot `weight_grams`, `length_mm`, `breadth_mm`
  and `height_mm`, so later catalogue edits cannot change historical shipment calculations.

## Changes from the plan (all documented in the journal)

- No `INCLUDE` on the inventory primary key, and a trigram index on `categories.path` (Prisma would
  otherwise report drift).
- Added `rate_limit_counters` (plan §10B needs DB-backed rate limits).
- Planned for Wave 8B: payment provider columns, `payment_webhook_receipts`, refund changes
  (additive only).
