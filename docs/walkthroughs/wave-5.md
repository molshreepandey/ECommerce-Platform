# Wave 5 walkthrough: warehouses and multi-warehouse inventory

Where each rule lives and how to see it. Read with TD-018 (ledger and idempotency), TD-019 (locks and
reservations), TD-020 (admin API), TD-021 (admin pages) and TD-022 (dispatch and restock).

## 1. Layers

| Layer          | Files                                                                                                                                                                                           | Job                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Database       | `inventory_levels` (CHECK `0 <= reserved <= on hand`, generated `available_quantity`), `inventory_movements` (sign, quantity and reason CHECKs), `inventory_change_requests`                    | the last line of defence: no negative stock, no over-reservation, no unexplained change        |
| Route handlers | `src/app/api/admin/{warehouses,inventory}/**/route.ts`                                                                                                                                          | permission, rate limit, `Idempotency-Key`, parse, call one service                             |
| Staff services | `warehouse.service.ts`, `stock-adjustment.service.ts`, `stock-receipt.service.ts`, `low-stock-threshold.service.ts`, `inventory-query.service.ts`                                               | permission again, transaction, locks, rules, ledger, audit, search outbox                      |
| Internal       | `reservation.service.ts` (reserve, release, re-allocate), `stock-dispatch.service.ts` (dispatch), `stock-restock.service.ts` (RTO and customer-return restock)                                  | called by checkout (Wave 8), shipments (Wave 9) and returns (Wave 12) inside their transaction |
| Pure rules     | `stock-rules.ts` (ledger convention, low stock, ceilings), `lock-order.ts` (the runtime lock tracker), `request-fingerprint.ts`                                                                 | unit-tested without a database                                                                 |
| Repositories   | `stock-level.repository.ts` (guarded updates), `inventory-movement.repository.ts` (ledger, per-shipment sums), `inventory-locks.ts`, `warehouse.repository.ts`, `inventory-query.repository.ts` | queries only                                                                                   |
| Pages          | `src/app/admin/{warehouses,inventory,inventory/movements,inventory/low-stock}/page.tsx`, `src/components/organisms/InventoryAdmin/`                                                             | server data, client dialogs that change data only through the API                              |

## 2. Rules worth explaining in a review

- **Stock lives per variant and warehouse.** Available is on hand minus reserved, computed by the
  database; application code never recomputes it.
- **Every change is a guarded `UPDATE … WHERE` plus a ledger row in the same transaction.** The guard
  refuses the change (409) before the CHECK would; the CHECK is the backstop. The ledger stores the
  after-values and the delta, so before-values are derived (TD-018 convention) and the ledger replays
  exactly to the stock row.
- **Staff changes are idempotent.** Each carries an `Idempotency-Key`; a retry replays the original
  result, the same key with a different change is 422, and two concurrent duplicates apply once.
- **One global lock order** (orders → shipments → requests → products → variants → warehouses → stock
  rows → inserts), enforced at runtime by `lock-order.ts`, so no two inventory transactions can deadlock.
- **Reservations belong to one shipment.** Release, dispatch and RTO restock are checked against that
  shipment's own ledger rows (a customer-return restock against its return request's items and earlier
  restocks), so one shipment can never take another's units, and a duplicate call changes nothing (409).
- **Dispatch and restock are always possible for goods physically there:** archived products and
  inactive warehouses are allowed. Only a new reservation needs an active product, variant and warehouse.
- **Deactivating a warehouse stops new reservations and removes it from storefront availability**, but
  keeps its stock and existing reservations (D30).

## 3. The stock life cycle

| Step                              | Function (caller, wave)                          | On hand | Reserved | Movement         |
| --------------------------------- | ------------------------------------------------ | ------- | -------- | ---------------- |
| Supplier delivery                 | `receiveStock` (admin, 5)                        | +q      |          | `RECEIPT`        |
| Count correction                  | `addStock`, `removeStock`, `setStock` (admin, 5) | ±q      |          | `ADJUSTMENT`     |
| Order placed                      | `reserveStock` (checkout, 8)                     |         | +q       | `RESERVE`        |
| Cancelled before dispatch         | `releaseReservation` (orders, 9)                 |         | −q       | `RELEASE`        |
| Handed to courier                 | `dispatchReservedStock` (shipments, 9)           | −q      | −q       | `DISPATCH`       |
| Returned to origin (RTO received) | `restockReturnedShipment` (shipments, 9)         | +q      |          | `RTO_RESTOCK`    |
| Customer return received          | `restockCustomerReturn` (returns, 12)            | +q      |          | `RETURN_RESTOCK` |

## 4. Try it

1. Sign in to the admin site as `inventory.manager@demo-store.test` (demo password, development only).
2. **Warehouses:** create one, edit it, deactivate it (the confirmation says stock and reservations stay),
   reactivate it.
3. **Inventory:** receive stock for a product, remove more than is on hand (refused with the number), set
   a counted quantity, give a variant an alert level above its stock.
4. **Stock movements:** open History for that variant: the three changes, each with before → after.
5. **Low stock** and the dashboard tile: the variant from step 3 is listed.
6. Sign in as `support@demo-store.test`: everything is visible, with no write controls.

Reservation, dispatch and restock have no screen yet (their callers arrive in Waves 8, 9 and 12); see
`tests/integration/stock-reservations.test.ts` and `stock-dispatch-restock.test.ts`.
