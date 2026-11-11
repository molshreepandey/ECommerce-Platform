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

| Constraint                                                                                                                        | Protects                                                                                                         | Proven by                                                |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `inventory_levels_quantities_check`: on hand ≥ 0, reserved ≥ 0, reserved ≤ on hand                                                | stock never negative or over-reserved                                                                            | `tests/integration/database-constraints.test.ts`         |
| generated `available_quantity = on_hand − reserved`                                                                               | availability can never be written inconsistently                                                                 | same                                                     |
| guarded `UPDATE … WHERE on_hand − reserved >= qty`                                                                                | reservations under concurrency (20 parallel against 7 units → exactly 7)                                         | same                                                     |
| `inventory_movements_quantities_after_check`: on hand after ≥ 0, reserved after ≥ 0, reserved after ≤ on hand after (Wave 5)      | no ledger row can record an impossible stock position                                                            | `tests/integration/inventory-ledger-constraints.test.ts` |
| `inventory_movements_quantity_delta_sign_check`: each movement type has one direction (ADJUSTMENT either way, 0 allowed) (Wave 5) | a reservation cannot shrink stock, a dispatch cannot add it; a new type fails until its direction is decided     | same                                                     |
| `inventory_movements_reason_check`: ADJUSTMENT and RECEIPT need a reason with a letter or digit (Wave 5)                          | every manual change explains itself                                                                              | same                                                     |
| unique `inventory_change_requests(staff_user_id, idempotency_key)` (Wave 5)                                                       | a retried stock request is applied once; a new key is a new request                                              | same                                                     |
| `product_variants_price_check`: 0 < price ≤ MRP                                                                                   | pricing errors                                                                                                   | same                                                     |
| `categories_level_check`, `categories_root_level_check`                                                                           | category tree depth 1–4                                                                                          | same                                                     |
| partial unique `customer_addresses_one_default_per_customer`                                                                      | one default address                                                                                              | same                                                     |
| `customer_addresses_pincode_check`                                                                                                | 6-digit Indian pincode                                                                                           | same                                                     |
| unique `orders(customer_id, idempotency_key)`                                                                                     | duplicate checkout                                                                                               | Wave 8 tests                                             |
| unique `(courier_partner_id, provider_event_id)` on webhook receipts                                                              | duplicate webhooks                                                                                               | Wave 9 tests                                             |
| `rate_limit_counters` primary key `(bucket_key, window_started_at)`                                                               | atomic rate-limit counting                                                                                       | `tests/integration/rate-limit.test.ts`                   |
| composite FK `product_media(product_id, variant_id)` → `product_variants(product_id, id)`, ON UPDATE/DELETE RESTRICT              | an image can only belong to a variant of its own product; a variant with images can be neither deleted nor moved | `tests/integration/catalogue-constraints.test.ts`        |
| `products_archived_at_check`: `status = ARCHIVED` exactly when `archived_at` is set                                               | one consistent product lifecycle                                                                                 | same                                                     |
| `products.version` (≥ 0)                                                                                                          | optimistic locking for admin edits (`UPDATE … WHERE version = n`)                                                | same                                                     |
| slug, type-code, attribute-code and SKU format checks                                                                             | clean URLs and keys; SKUs upper-case, at most 64 characters                                                      | same                                                     |
| `attribute_definitions_allowed_values_check`, `…_variant_option_enum_check`                                                       | choice attributes always have allowed values; variant options are single-choice                                  | same                                                     |
| `product_media_position_check`, `product_media_alt_text_check`                                                                    | image order from 0; every image has alt text                                                                     | same                                                     |

Every catalogue foreign key is `ON DELETE RESTRICT`, and the project has no triggers: archiving a product or
variant is a status change only, so stock rows, reservations, movements, order lines, cart lines, reviews
and collection links are never deleted or modified by it (TD-016).

## Inventory ledger conventions (Wave 5, TD-018 and TD-019)

- `inventory_levels.available_quantity` is generated (`on_hand_quantity − reserved_quantity`); the CHECK
  `0 ≤ reserved ≤ on hand` keeps it from going negative.
- Each movement stores its delta and the quantities **after** it. RESERVE and RELEASE change reserved,
  DISPATCH lowers on hand and reserved together by its (negative) delta, every other type changes on hand;
  "before" values are derived from that, never stored. The existing data replays exactly by this rule.
- `reference_type`/`reference_id`: `shipment` for RESERVE, RELEASE and DISPATCH (what a shipment still has
  reserved is the sum of those three deltas for that shipment, variant and warehouse);
  `inventory_change_request` for staff adjustments and receipts (the idempotent request that wrote them).
  No foreign key backs these references; only the inventory services write them.
- Staff stock requests are rows in `inventory_change_requests` (unique per staff member and key), kept
  indefinitely.

## Integrity requirements for later waves (mandatory)

- **Wave 8, before order placement:** add the composite FK `order_items(product_id, variant_id)` →
  `product_variants(product_id, id)` (the unique key already exists). Re-run the read-only check first; on
  2026-11-10 it found 0 mismatched rows in development.
- **Wave 8, before order placement:** order items must snapshot `weight_grams`, `length_mm`, `breadth_mm`
  and `height_mm`, so later catalogue edits cannot change historical shipment calculations.
- **Wave 8 checkout:** insert the order and its shipments before reserving, and reserve only through
  `reserveStock` / `applyReservationChanges` inside the checkout transaction (caller contract, TD-019).
- **Wave 9 dispatch, cancellation and restock:** lock order and shipment rows first, then go through the
  inventory services; dispatch writes a DISPATCH movement per shipment line (negative delta, on hand and
  reserved both lowered). Real dispatch-versus-cancellation race tests are mandatory.

## Changes from the plan (all documented in the journal)

- No `INCLUDE` on the inventory primary key, and a trigram index on `categories.path` (Prisma would
  otherwise report drift).
- Added `rate_limit_counters` (plan §10B needs DB-backed rate limits).
- Planned for Wave 8B: payment provider columns, `payment_webhook_receipts`, refund changes
  (additive only).
