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

## Order-line snapshots and online payment (Wave 8, migration `20261114090000`)

Built as required (the former "integrity requirements for later waves"):

- **Composite FK** `order_items(product_id, variant_id)` → `product_variants(product_id, id)`: an order line
  can never name a variant of another product.
- **Snapshots on `order_items`**, deliberately without foreign keys so later catalogue edits never change
  history: `weight_grams`, `length_mm`, `breadth_mm`, `height_mm` (NOT NULL, all > 0), `category_id`,
  `category_path`, `category_name` (all three NULL or all three set) and `product_group_id`.
- **`payment_attempts`** for the simulated online gateway: one row per attempt, unique
  `(payment_id, idempotency_key)`, at most one `SUCCEEDED` attempt per payment (partial unique index),
  `amount_paise > 0`, a decline code exactly when declined. `PaymentMethod` gained `ONLINE`.
- `CHECK`s on order idempotency keys and request fingerprints; indexes for the payments report, the
  customer list and the webhook log. Migration `20261114180000` adds the daily-manifest index
  `shipments(warehouse_id, shipped_at)`.
- Checkout inserts the order and shipments, then reserves only through `applyReservationChanges` inside
  the same transaction; dispatch, cancellation and restock lock order and shipment rows first (TD-019).

## Tables by module (47)

| Module              | Tables                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and access | `customers`, `customer_addresses`, `staff_users`, `roles`, `permissions`, `role_permissions`, `staff_user_roles`, `sessions`, `otp_challenges`, `rate_limit_counters` |
| Catalogue           | `product_types`, `attribute_definitions`, `brands`, `products`, `product_variants`, `product_media`                                                                   |
| Taxonomy            | `categories`, `product_groups`                                                                                                                                        |
| Inventory           | `warehouses`, `inventory_levels`, `inventory_movements`, `inventory_change_requests` (idempotent stock writes)                                                        |
| Cart and pricing    | `carts`, `cart_items`, `coupons`, `coupon_redemptions`, `store_settings`                                                                                              |
| Orders and payments | `orders`, `order_items`, `order_status_history`, `payments`, `payment_attempts`, `refunds`                                                                            |
| Fulfilment          | `shipments`, `shipment_items`, `shipment_tracking_events`, `courier_partners`, `courier_serviceable_pincodes`, `courier_webhook_receipts`                             |
| Returns             | `return_requests`, `return_request_items`                                                                                                                             |
| Merchandising       | `banners`, `collections`, `collection_products`, `reviews`                                                                                                            |
| Search and audit    | `search_outbox`, `audit_logs`                                                                                                                                         |

## Migrations

| Migration                                        | What it adds                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `20261107000000_init`                            | every plan §9.2 table, CHECKs, partial/GIN/BRIN/trigram indexes, `pg_trgm` |
| `20261107150000_identity_constraints`            | identity uniqueness and session constraints                                |
| `20261110093000_catalogue_integrity`             | catalogue integrity indexes and the composite image FK                     |
| `20261110150000_inventory_receipt_movement_type` | `RECEIPT` inventory movement type                                          |
| `20261110150100_inventory_ledger_integrity`      | ledger integrity constraints                                               |
| `20261114090000_order_snapshots_online_payment`  | order-line snapshots, composite FK, `payment_attempts`, `ONLINE`           |
| `20261114180000_shipment_manifest_index`         | `shipments(warehouse_id, shipped_at)` index                                |

**PostgreSQL 18 is required:** primary keys default to the built-in `uuidv7()`. A fresh database gets
everything from `npm run db:deploy` (rehearsed on a disposable database on 2026-11-15:
[`test-evidence.md`](test-evidence.md)); rollback scripts for the two newest migrations are in
`prisma/rollbacks/`, and applying them to an existing database is described in
[`migrations/dev-migration-checklist.md`](migrations/dev-migration-checklist.md).

## Changes from the plan (all documented in the journal)

- No `INCLUDE` on the inventory primary key, and a trigram index on `categories.path` (Prisma would
  otherwise report drift).
- Added `rate_limit_counters` (plan §10B needs DB-backed rate limits).
- Online payment is a simulated gateway with `payment_attempts` (owner decision 2026-11-14) instead of the
  plan's COD-only scope; no payment webhooks exist because no real gateway is integrated.
