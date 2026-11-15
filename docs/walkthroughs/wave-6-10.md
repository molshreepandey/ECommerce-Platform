# Waves 6–10 walkthrough (storefront, cart, checkout, fulfilment, admin)

Owner decisions of 2026-11-14: canonical P0 scope (Waves 6–10) plus hardening and documentation; a
simulated online gateway alongside Cash on Delivery; L31 as order-line snapshot columns; migration
`20261114090000_order_snapshots_online_payment` approved for the **test database only**.

## What was found before starting

- The uncommitted Wave 6 work had working search, outbox, Postgres-fallback and storefront services, but
  its pages were in `src/app/search`, `src/app/products` and `src/app/categories` (outside the store
  surface, so unreachable through the host proxy) and failed `npm run typecheck` with 17 errors. The
  pages were rebuilt under `src/app/store/` (originals kept in the session scratchpad); the services were
  kept.
- "Wave 7 authentication and account" in the request is the canonical Wave 2B, already committed
  (`f2c40ab`) with its tests.

## Wave 6 — storefront

| Page       | Path (store host)                                                        | Notes                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home       | `/`                                                                      | top categories, new arrivals, links that work (the old buttons did nothing)                                                                                                                 |
| Search     | `/search?q&brand&minPrice&maxPrice&inStock&rating&attr.<code>&sort&page` | filter sidebar (GET form), sort, URL pagination; PostgreSQL fallback while Elasticsearch is down (not shown to customers)                                                                   |
| Categories | `/categories`, `/categories/<slug>`                                      | whole tree; a category includes its descendants; unknown slug → real 404                                                                                                                    |
| Product    | `/products/<slug>`                                                       | gallery, MRP vs price, variant picker with unavailable and out-of-stock values disabled, live availability, group swatches, attribute table, Add to cart / Buy now; unknown slug → real 404 |

The store root `loading.tsx` moved into `account/` and `search/`: a loading boundary above a page that
calls `notFound()` turns the 404 into a streamed 200. Product and category pages block (`instant = false`)
so an unknown slug answers 404. Catalogue reads that are Redis-cached defer to request time
(`connection()`), so the build never needs the database.

## Wave 7 — cart, pricing, coupons, settings (TD-023)

Cart page `/cart`, header cart link with item count, admin `/coupons` and `/settings`. Guests have a cookie
cart merged on sign-in or registration.

## Wave 8 — checkout (TD-024)

`/checkout`: choose address and payment (online or COD), the server prices the order (summary endpoint),
**Place order** sends an `Idempotency-Key`. Online orders go to `/orders/<id>/pay` (simulated gateway with
success and two decline scenarios); COD orders go straight to the confirmation.

## Wave 9 — orders, fulfilment, courier (TD-025)

Customer: `/orders` (status filter, older pages), `/orders/<id>` (items, payment, per-shipment tracking,
history, cancel with reason while nothing has shipped). Admin: `/orders` (search by order number, email,
phone or AWB; status, payment and date filters), `/orders/<id>` (confirm, cancel, per-shipment actions,
label PDF, simulate scans, audit), `/couriers` (partners, serviceable pincodes, webhook log).

## Wave 10 — customers, dashboard, reports, audit (TD-026)

Admin `/` dashboard (KPIs and four charts for a date range), `/reports` (reconciliation, top products and
categories, stock by warehouse), `/customers` (search, detail, block/unblock), `/audit` (filters, older
pages).

## Demo walkthrough

See README "Demo walkthrough". The admin's order page drives the whole delivery with
**Simulate pickup scan → Simulate next scan → Simulate delivered scan**.

## Verification

Recorded in `IMPLEMENTATION_PROGRESS.md` (2026-11-14 entry) with the exact commands and counts.
