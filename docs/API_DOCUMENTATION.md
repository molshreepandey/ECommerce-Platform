# API documentation

Status: conventions, health, and the Wave 2B identity endpoints (sign-in, sessions, profile, addresses,
staff sign-in). Feature endpoints are added per wave; the plan generates an OpenAPI 3.1 document and a
Swagger UI from the Zod schemas in Wave 15.

## Conventions

- **Hosts:** store APIs under `/api/store/*` on the store host; admin APIs under `/api/admin/*` on the admin
  host; the other host returns 404 with the error envelope.
- **Error envelope:** every error response is
  `{ "error": { "code": "STRING_CODE", "message": "Human readable", "details": … } }`.

  | HTTP | When                                    | Example code                                                       |
  | ---- | --------------------------------------- | ------------------------------------------------------------------ |
  | 400  | input failed validation                 | `VALIDATION_FAILED` (details has `fieldErrors`), `INVALID_JSON`    |
  | 401  | not signed in or session expired        | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`                           |
  | 403  | not allowed, or cross-site request      | `ORIGIN_NOT_ALLOWED`, `WRONG_ACCOUNT_TYPE`, `PERMISSION_DENIED`    |
  | 404  | unknown route or wrong host             | `NOT_FOUND`                                                        |
  | 409  | conflict with current state             | `EMAIL_ALREADY_REGISTERED`, `PHONE_ALREADY_REGISTERED`             |
  | 422  | valid input that breaks a business rule | e.g. unserviceable pincode                                         |
  | 429  | rate limit reached                      | `RATE_LIMITED` (header `Retry-After`, details `retryAfterSeconds`) |
  | 500  | unexpected                              | `INTERNAL_ERROR` (details are never leaked)                        |
  | 503  | database transaction timed out          | `TRANSACTION_TIMEOUT` (nothing committed; header `Retry-After: 1`) |

- **Same-origin rule:** `POST`, `PUT`, `PATCH` and `DELETE` must send an `Origin` header equal to the site's
  public origin (for example `http://store.localhost:3000`); otherwise 403 `ORIGIN_NOT_ALLOWED`.
- **Sessions:** sign-in sets an `HttpOnly`, `SameSite=Lax` cookie: `store_session` on the store host,
  `admin_session` on the admin host (`__Host-` prefixed and `Secure` in staging and production). Browsers
  send it automatically; API clients send it as a `Cookie` header. See TD-011.
- **Idempotency:** requests that must not apply twice (stock adjustments and receipts; checkout in Wave 8)
  need an `Idempotency-Key` header (16–100 of `A-Z a-z 0-9 _ -`; send a new UUID per user action and the
  same key on every retry). Missing: 400 `IDEMPOTENCY_KEY_REQUIRED`; malformed: 400
  `IDEMPOTENCY_KEY_INVALID`. The same key with the same content returns the original result (200,
  `replayed: true`) and applies nothing; the same key with different content returns 422
  `IDEMPOTENCY_KEY_REUSED`. Keys belong to the signed-in staff member. See TD-018 and TD-020.
- **Tracing:** every response carries `x-request-id`; the same id appears in every server log line for
  that request. Clients may send their own `x-request-id` (8–64 letters, digits or dashes).

## `GET /api/health`

Available on both hosts. Not cached (`Cache-Control: no-store`).

```json
{
  "status": "ok",
  "checks": {
    "postgres": { "status": "up", "critical": true },
    "elasticsearch": { "status": "up", "critical": false },
    "redis": { "status": "up", "critical": false }
  }
}
```

`status` is `ok` (200), `degraded` (200: only non-critical dependencies down) or `unavailable` (503:
Postgres down). Each probe gives up after `health.probeTimeoutMilliseconds` (2 s by default).

## Store: authentication (`/api/store/auth/*`, store host)

| Method and path                   | Body                                   | Success                                          | Errors                                                                    |
| --------------------------------- | -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `POST /api/store/auth/register`   | `{ fullName, email, phone, password }` | 201 `{ customer }` and sets `store_session`      | 400, 409 `EMAIL_ALREADY_REGISTERED` / `PHONE_ALREADY_REGISTERED`, 429     |
| `POST /api/store/auth/login`      | `{ email, password }`                  | 200 `{ customer: { id } }` and sets the cookie   | 400, 401 `INVALID_CREDENTIALS` (same body for every failure, TD-012), 429 |
| `POST /api/store/auth/logout`     | none                                   | 204; ends this session and clears the cookie     | none (signing out without a session also answers 204)                     |
| `POST /api/store/auth/logout-all` | none                                   | 200 `{ revokedSessionCount }`; clears the cookie | 401                                                                       |

Field rules (`src/modules/identity/identity.schema.ts`):

| Field      | Rule                                                           |
| ---------- | -------------------------------------------------------------- |
| `fullName` | 2–100 characters after trimming                                |
| `email`    | valid email, at most 254 characters; trimmed and lower-cased   |
| `phone`    | Indian mobile: 10 digits starting with 6–9, no `+91` or spaces |
| `password` | 8–128 characters (sign-in accepts 1–128)                       |

Outside development and test, registration also answers 400 for the publicly known demo password or an
`@demo-store.test` email, and sign-in with either answers the ordinary 401 (TD-013).

Example:

```http
POST /api/store/auth/register
Host: store.localhost:3000
Origin: http://store.localhost:3000
Content-Type: application/json

{ "fullName": "Priya Nair", "email": "Priya.Nair@example.com", "phone": "9876501000", "password": "Correct-Horse-2026" }
```

```http
HTTP/1.1 201 Created
Set-Cookie: store_session=…; Path=/; Expires=…; HttpOnly; SameSite=lax

{ "customer": { "id": "0190…", "fullName": "Priya Nair", "email": "priya.nair@example.com", "phone": "9876501000" } }
```

## Store: account (`/api/store/account/*`, store host, signed-in customer)

All return 401 `UNAUTHENTICATED` without a valid customer session and 403 `WRONG_ACCOUNT_TYPE` for a staff
session.

| Method and path                                         | Body                                   | Success                                          | Errors                              |
| ------------------------------------------------------- | -------------------------------------- | ------------------------------------------------ | ----------------------------------- |
| `GET /api/store/account/profile`                        | none                                   | 200 `{ profile }`                                |                                     |
| `PATCH /api/store/account/profile`                      | `{ fullName?, phone? }` (at least one) | 200 `{ profile }`                                | 400, 409 `PHONE_ALREADY_REGISTERED` |
| `GET /api/store/account/addresses`                      | none                                   | 200 `{ addresses }` (default first, then newest) |                                     |
| `POST /api/store/account/addresses`                     | address fields + optional `isDefault`  | 201 `{ address }`                                | 400                                 |
| `PATCH /api/store/account/addresses/{addressId}`        | any address fields (at least one)      | 200 `{ address }`                                | 400, 404 `ADDRESS_NOT_FOUND`        |
| `DELETE /api/store/account/addresses/{addressId}`       | none                                   | 204 (archived, not deleted)                      | 400, 404                            |
| `POST /api/store/account/addresses/{addressId}/default` | none                                   | 200 `{ address }`                                | 400, 404                            |

Address fields:

- `recipientName` and `phone`: the same rules as the profile fields.
- `addressLine1`: 3–200 characters.
- `addressLine2`: optional, up to 200 characters.
- `landmark`: optional, up to 100 characters.
- `city` and `state`: 2–100 characters.
- `pincode`: 6 digits, not starting with 0.

Rules:

- A customer's first address becomes the default.
- `isDefault: true` or the `/default` call moves the default.
- Archiving the default promotes the newest remaining address.
- Another customer's address answers 404, the same as an address that does not exist.
- `{addressId}` must be a UUID (400 otherwise).

## Admin: authentication (`/api/admin/auth/*`, admin host)

| Method and path               | Body                  | Success                                                                             | Errors                              |
| ----------------------------- | --------------------- | ----------------------------------------------------------------------------------- | ----------------------------------- |
| `POST /api/admin/auth/login`  | `{ email, password }` | 200 `{ staffUser: { id } }` and sets `admin_session` (12 hours)                     | 400, 401 `INVALID_CREDENTIALS`, 429 |
| `POST /api/admin/auth/logout` | none                  | 204; ends the session and clears the cookie                                         |                                     |
| `GET /api/admin/auth/me`      | none                  | 200 `{ staffUser: { id, fullName, email, roles: [{code,name}], permissionCodes } }` | 401, 403 `WRONG_ACCOUNT_TYPE`       |

Admin APIs added in later waves check a named permission (for example `orders.read`) and answer 403
`PERMISSION_DENIED` with `details: { requiredPermission }` when the staff member's roles lack it.

## Admin: catalogue (`/api/admin/*`, admin host, Wave 3)

Every route needs a staff session (401 otherwise) and `catalogue.read` for `GET` or `catalogue.write` for
everything else (403 `PERMISSION_DENIED`). The permission is checked before the input is validated.
Path ids must be UUIDs (400). Bodies are strict: unknown fields are refused (400). Create returns 201; other
writes return 200. Item routes for variants and images are flat (`/api/admin/variants/{id}`,
`/api/admin/media/{id}`), like `/api/admin/attribute-definitions/{id}`; list and create routes are nested
under their parent.

| Method and path                                            | Body or query                                                                                                                                                                 | Success                                                                            | Main errors                                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /api/admin/product-types`                             | —                                                                                                                                                                             | `{ productTypes }`                                                                 |                                                                                                 |
| `POST /api/admin/product-types`                            | `{ code, name, description? }`                                                                                                                                                | 201 `{ productType }`                                                              | 409 `PRODUCT_TYPE_CODE_TAKEN`                                                                   |
| `GET /api/admin/product-types/{id}`                        | —                                                                                                                                                                             | `{ productType }` with `attributeDefinitions`                                      | 404                                                                                             |
| `PATCH /api/admin/product-types/{id}`                      | `{ name?, description? }`                                                                                                                                                     | `{ productType }`                                                                  | 409 `PRODUCT_TYPE_ARCHIVED`                                                                     |
| `POST /api/admin/product-types/{id}/archive`               | —                                                                                                                                                                             | `{ productType }`                                                                  | 409 `PRODUCT_TYPE_IN_USE`                                                                       |
| `POST /api/admin/product-types/{id}/restore`               | —                                                                                                                                                                             | `{ productType }`                                                                  | 409 `PRODUCT_TYPE_NOT_ARCHIVED`                                                                 |
| `POST /api/admin/product-types/{id}/attribute-definitions` | `{ code, label, dataType, scope, isRequired?, isFilterable?, isSearchable?, allowedValues?, displayOrder? }`                                                                  | 201 `{ attributeDefinition }`                                                      | 409 `ATTRIBUTE_CODE_TAKEN`, `ATTRIBUTE_REQUIRED_BUT_MISSING`                                    |
| `PATCH /api/admin/attribute-definitions/{id}`              | `{ label?, isRequired?, isFilterable?, isSearchable?, allowedValues?, displayOrder? }` (code, type and scope never change)                                                    | `{ attributeDefinition }`                                                          | 409 `ATTRIBUTE_VALUE_IN_USE`, `ATTRIBUTE_REQUIRED_BUT_MISSING`, `ATTRIBUTE_DEFINITION_ARCHIVED` |
| `POST /api/admin/attribute-definitions/{id}/archive`       | —                                                                                                                                                                             | `{ attributeDefinition }`                                                          | 409 `ATTRIBUTE_IN_USE`                                                                          |
| `GET /api/admin/brands`                                    | —                                                                                                                                                                             | `{ brands }`                                                                       |                                                                                                 |
| `POST /api/admin/brands`                                   | `{ name, slug?, logoUrl? }`                                                                                                                                                   | 201 `{ brand }`                                                                    | 409 `BRAND_SLUG_TAKEN`                                                                          |
| `PATCH /api/admin/brands/{id}`                             | `{ name?, slug?, logoUrl?, isActive? }`                                                                                                                                       | `{ brand }`                                                                        | 404, 409                                                                                        |
| `GET /api/admin/products`                                  | query `search, productTypeId, brandId, status, categoryId, taggingStatus, productGroupId, stock (IN_STOCK, OUT_OF_STOCK), sort (NEWEST, OLDEST, NAME), limit (1–100), cursor` | `{ items, totalCount, nextCursor }`; archived products only with `status=ARCHIVED` | 400 for unknown or bad parameters                                                               |
| `POST /api/admin/products`                                 | `{ productTypeId, brandId, name, slug?, description?, attributes, taxRateBasisPoints }`                                                                                       | 201 `{ product }` (DRAFT, version 0)                                               | 400 `attributes.<code>`, 404, 409 `PRODUCT_SLUG_TAKEN`, 422 `BRAND_INACTIVE`                    |
| `GET /api/admin/products/{id}`                             | —                                                                                                                                                                             | `{ product }` with variants and images                                             | 404                                                                                             |
| `PATCH /api/admin/products/{id}`                           | `{ expectedVersion, name?, slug?, description?, brandId?, attributes?, taxRateBasisPoints? }`                                                                                 | `{ product }`                                                                      | 409 `STALE_PRODUCT`, `PRODUCT_ARCHIVED`, `PRODUCT_SLUG_LOCKED`                                  |
| `POST /api/admin/products/{id}/status`                     | `{ expectedVersion, status }`                                                                                                                                                 | `{ product }`                                                                      | 409 `INVALID_STATUS_TRANSITION`, `STALE_PRODUCT`; 422 `PRODUCT_NOT_READY` (`details.reasons`)   |
| `POST /api/admin/products/{id}/variants`                   | `{ sku, optionValues, mrpPaise, pricePaise, weightGrams, lengthMm, breadthMm, heightMm }`                                                                                     | 201 `{ variant, productVersion }`                                                  | 400 `optionValues.<code>`, 409 `SKU_TAKEN`, `DUPLICATE_VARIANT_COMBINATION`                     |
| `POST /api/admin/products/{id}/variants/generate`          | `{ options: { code: [values] }, skuPrefix, …measurements }`                                                                                                                   | `{ created, skippedOptionSignatures, productVersion }`                             | 400 (over 100 combinations), 409 `SKU_TAKEN` (nothing created)                                  |
| `PATCH /api/admin/variants/{id}`                           | `{ mrpPaise?, pricePaise?, weightGrams?, lengthMm?, breadthMm?, heightMm? }`                                                                                                  | `{ variant, productVersion }`                                                      | 409 `VARIANT_ARCHIVED`                                                                          |
| `POST /api/admin/variants/{id}/status`                     | `{ status }`                                                                                                                                                                  | `{ variant, productVersion }`                                                      | 409 `LAST_ACTIVE_VARIANT`, `INVALID_STATUS_TRANSITION`; 422 `VARIANT_OPTIONS_OUTDATED`          |
| `POST /api/admin/products/{id}/media`                      | `{ url, altText, variantId? }`                                                                                                                                                | 201 `{ media, productVersion }`                                                    | 400 (host not allowed), 409 `MEDIA_LIMIT_REACHED`, 422 `VARIANT_NOT_IN_PRODUCT`                 |
| `PUT /api/admin/products/{id}/media/order`                 | `{ mediaIds }` (all current images, new order)                                                                                                                                | `{ media, productVersion }`                                                        | 409 `STALE_MEDIA_ORDER`                                                                         |
| `PATCH /api/admin/media/{id}`                              | `{ altText?, variantId? }`                                                                                                                                                    | `{ media, productVersion }`                                                        | 422 `VARIANT_NOT_IN_PRODUCT`                                                                    |
| `DELETE /api/admin/media/{id}`                             | —                                                                                                                                                                             | `{ productVersion }`                                                               | 404                                                                                             |

Prices are integer paise (`mrpPaise`, `pricePaise`); price must not exceed MRP (400). Variant and image
changes also increase the product's `version` and return the new value as `productVersion`.

## Admin: categories, tagging and product groups (`/api/admin/*`, admin host, Wave 4)

Same conventions as the catalogue routes: a staff session (401 otherwise), `catalogue.read` for `GET` and
`taxonomy.write` for everything else (403 `PERMISSION_DENIED`, checked before the input), UUID path ids
(400), strict bodies (400 for unknown fields). Create returns 201, delete returns 204 with no body, other
writes return 200.

| Method and path                                             | Body or query                                                                       | Success                                                                                                      | Main errors                                                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/categories`                                 | —                                                                                   | `{ categories }` (flat, ordered by path, with `childCount`, `directProductCount` and subtree `productCount`) |                                                                                                                                              |
| `POST /api/admin/categories`                                | `{ name, slug?, parentId?, position? }`                                             | 201 `{ category }`                                                                                           | 404 `CATEGORY_NOT_FOUND`; 409 `CATEGORY_SLUG_TAKEN`, `CATEGORY_HAS_PRODUCTS`; 422 `CATEGORY_TOO_DEEP`, `PARENT_CATEGORY_INACTIVE`            |
| `PATCH /api/admin/categories/{id}`                          | `{ name?, slug?, position? }` (at least one)                                        | `{ category }`                                                                                               | 404; 409 `CATEGORY_SLUG_TAKEN`                                                                                                               |
| `DELETE /api/admin/categories/{id}`                         | —                                                                                   | 204                                                                                                          | 404; 409 `CATEGORY_HAS_CHILDREN`, `CATEGORY_HAS_PRODUCTS` (`details.productCount`, archived products included)                               |
| `POST /api/admin/categories/{id}/move`                      | `{ parentId (null for top level), position? }`                                      | `{ category }`                                                                                               | 404; 409 `CATEGORY_MOVE_CYCLE`, `CATEGORY_HAS_PRODUCTS` (new parent); 422 `CATEGORY_TOO_DEEP`, `PARENT_CATEGORY_INACTIVE`                    |
| `POST /api/admin/categories/{id}/status`                    | `{ isActive }`                                                                      | `{ category }`                                                                                               | 404; 422 `PARENT_CATEGORY_INACTIVE` (activating under an inactive parent)                                                                    |
| `POST /api/admin/tagging`                                   | `{ productIds (1–100, unique), categoryId (null to untag) }`                        | `{ changedProductIds, unchangedProductIds }`                                                                 | 404 `CATEGORY_NOT_FOUND`; 409 `PRODUCTS_ARCHIVED` (`details.productIds`); 422 `CATEGORY_NOT_LEAF`, `CATEGORY_INACTIVE`, `PRODUCTS_NOT_FOUND` |
| `GET /api/admin/product-groups`                             | query `search?`                                                                     | `{ productGroups }` with `memberCount`                                                                       | 400 for unknown parameters                                                                                                                   |
| `POST /api/admin/product-groups`                            | `{ name }`                                                                          | 201 `{ productGroup }`                                                                                       |                                                                                                                                              |
| `GET /api/admin/product-groups/{id}`                        | —                                                                                   | `{ productGroup }` with ordered `members`                                                                    | 404 `PRODUCT_GROUP_NOT_FOUND`                                                                                                                |
| `PATCH /api/admin/product-groups/{id}`                      | `{ name }`                                                                          | `{ productGroup }`                                                                                           | 404                                                                                                                                          |
| `DELETE /api/admin/product-groups/{id}`                     | —                                                                                   | 204 (members are ungrouped, not changed otherwise)                                                           | 404                                                                                                                                          |
| `POST /api/admin/product-groups/{id}/members`               | `{ productIds (1–50, unique) }`                                                     | `{ productGroup }` (existing members are skipped)                                                            | 404; 409 `PRODUCT_IN_ANOTHER_GROUP`, `PRODUCTS_ARCHIVED`; 422 `GROUP_FULL` (`details.limit`, `details.memberCount`), `PRODUCTS_NOT_FOUND`    |
| `PUT /api/admin/product-groups/{id}/members`                | `{ members: [{ productId, swatchLabel (1–40 or null) }] }` (all members, new order) | `{ productGroup }`                                                                                           | 404; 409 `STALE_GROUP_MEMBERS`                                                                                                               |
| `DELETE /api/admin/product-groups/{id}/members/{productId}` | —                                                                                   | `{ productGroup }` (remaining members renumbered)                                                            | 404 `PRODUCT_GROUP_NOT_FOUND`, `PRODUCT_NOT_IN_GROUP`                                                                                        |

Rules: at most 4 levels; products sit only on leaf categories; a move or slug change rewrites the subtree's
paths; deactivation cascades to the subtree; only an empty leaf can be deleted. Tagging is all-or-nothing.
A group holds at most 50 products and a product belongs to at most one group. Every change writes its audit
rows and search-outbox rows in the same transaction; tagging and membership changes also increase each
changed product's `version`.

## Admin: warehouses and inventory (`/api/admin/*`, admin host, Wave 5)

Same conventions as the catalogue routes: a staff session (401 otherwise), strict bodies (400 for unknown
fields), UUID path ids and query ids (400), and the permission checked before the input (403
`PERMISSION_DENIED`). Reads need `inventory.read`; stock changes and thresholds need `inventory.write`;
warehouse create, edit and status need `warehouses.write`. The services check the same permission again,
so a route cannot bypass it. Every write route also has a per-staff budget shared by all six of them
(`inventory-write`: 60 writes per 60 seconds; 429 `RATE_LIMITED` with `Retry-After`, nothing applied,
retry with the same `Idempotency-Key`); it is counted after the session and permission checks, and reads
are not limited. Ids may be sent in any letter case. Receipts and thresholds lower-case them, so a receipt
naming one variant twice in different case is 400; for adjustments the letter case is part of the
idempotency fingerprint, so a retry must repeat the ids exactly (otherwise 422 `IDEMPOTENCY_KEY_REUSED`).
Audit rows for warehouse edits and status changes record the path id as sent, so an upper-case id is stored
upper case (L55). 503 `TRANSACTION_TIMEOUT` is returned only when the database transaction timed out or could not start in
time; nothing was committed and the same request can be retried. Reservations have no HTTP route: they are internal to checkout and orders (TD-019).

| Method and path                          | Body or query                                                                                                                                                                                                                         | Success                                                                        | Main errors                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/warehouses`              | —                                                                                                                                                                                                                                     | `{ warehouses }` (by priority, then code)                                      |                                                                                                                                                                      |
| `POST /api/admin/warehouses`             | `{ code, name, addressLine1, addressLine2?, city, state, pincode, contactName, contactPhone, priority }`                                                                                                                              | 201 `{ warehouse }` (active; code upper-cased)                                 | 409 `WAREHOUSE_CODE_TAKEN`                                                                                                                                           |
| `GET /api/admin/warehouses/{id}`         | —                                                                                                                                                                                                                                     | `{ warehouse }`                                                                | 404 `WAREHOUSE_NOT_FOUND`                                                                                                                                            |
| `PATCH /api/admin/warehouses/{id}`       | any of the create fields except `code` (at least one)                                                                                                                                                                                 | `{ warehouse }` (only submitted fields change; last save wins)                 | 404                                                                                                                                                                  |
| `POST /api/admin/warehouses/{id}/status` | `{ isActive }`                                                                                                                                                                                                                        | `{ warehouse }` (same status: no change)                                       | 404                                                                                                                                                                  |
| `GET /api/admin/inventory`               | query `search?` (product name or SKU), `warehouseId?`, `lowStockOnly?` (`true`/`false`), `limit` (1–100, default 50), `cursor?`                                                                                                       | stock matrix `{ items: [product → variants → levels], nextCursor }`            | 400 for bad parameters, 400 `INVALID_CURSOR`                                                                                                                         |
| `POST /api/admin/inventory/adjustments`  | header `Idempotency-Key`; `{ operation: "ADD" \| "REMOVE", variantId, warehouseId, quantity (1–100,000), reason }` or `{ operation: "SET", variantId, warehouseId, expectedOnHandQuantity, newOnHandQuantity (0–1,000,000), reason }` | 201 `{ stockRequest }`; 200 when replayed                                      | 404 `VARIANT_NOT_FOUND`, `WAREHOUSE_NOT_FOUND`; 409 `STALE_STOCK`, `STOCK_BELOW_RESERVED`; 422 `NO_STOCK_CHANGE`, `ON_HAND_LIMIT_EXCEEDED`, `IDEMPOTENCY_KEY_REUSED` |
| `POST /api/admin/inventory/receipts`     | header `Idempotency-Key`; `{ warehouseId, supplierReference, lines: [{ variantId, quantity }] }` (1–100 lines, each variant once)                                                                                                     | 201 `{ stockRequest }`; 200 when replayed                                      | 404; 422 `ON_HAND_LIMIT_EXCEEDED`, `IDEMPOTENCY_KEY_REUSED` (the whole receipt or nothing)                                                                           |
| `PUT /api/admin/inventory/thresholds`    | `{ variantId, warehouseId, lowStockThreshold (0–100,000) }`                                                                                                                                                                           | `{ changed, stockLevel }` (same value: `changed: false`)                       | 404; 422 `THRESHOLD_NOT_ALLOWED` (archived product or variant: only 0)                                                                                               |
| `GET /api/admin/inventory/movements`     | query `warehouseId?`, `variantId?`, `movementType?`, `createdFrom?`, `createdTo?` (ISO 8601 with offset), `limit`, `cursor?`                                                                                                          | ledger `{ movements, nextCursor }`, newest first, with before and after values | 400 for bad parameters, 400 `INVALID_CURSOR`                                                                                                                         |
| `GET /api/admin/inventory/low-stock`     | query `warehouseId?`, `includeInactiveWarehouses?` (`true`/`false`), `limit`, `cursor?` (`warehouseId/variantId`)                                                                                                                     | `{ items, nextCursor, totalCount }`                                            | 400 for bad parameters                                                                                                                                               |

`stockRequest` is `{ changeRequestId, operation (ADJUST_ADD, ADJUST_REMOVE, ADJUST_SET, RECEIPT), replayed,
movements }`; each movement has `quantityDelta`, `onHandBefore`/`onHandAfter`,
`reservedBefore`/`reservedAfter`, `availableAfter` and `reason` (the supplier reference for a receipt).
Adjustments are ADJUSTMENT movements and receipts are RECEIPT movements; each writes one ledger row and one
audit row per changed stock row in the same transaction. Rules: removing or setting below what is reserved
is refused (409 `STOCK_BELOW_RESERVED`); a set must state the on-hand quantity it saw (409 `STALE_STOCK`
with `currentOnHandQuantity`); add and receipt stop at 1,000,000 on hand, the same ceiling as set (422
`ON_HAND_LIMIT_EXCEEDED`). Adjustments and receipts are allowed for archived products and inactive
warehouses (the goods are physically there). Low stock means a threshold above 0 and available at or below
it, never for archived products or variants, and only in active warehouses unless
`includeInactiveWarehouses=true`. Decisions: TD-018, TD-019, TD-020.
