# API documentation

Status: conventions, health, and the Wave 2B identity endpoints (sign-in, sessions, profile, addresses,
staff sign-in). Feature endpoints are added per wave; the plan generates an OpenAPI 3.1 document and a
Swagger UI from the Zod schemas in Wave 15.

## Conventions

- **Hosts:** store APIs under `/api/store/*` on the store host; admin APIs under `/api/admin/*` on the admin
  host; the other host returns 404 with the error envelope.
- **Error envelope:** every error response is
  `{ "error": { "code": "STRING_CODE", "message": "Human readable", "details": … } }`.

  | HTTP | When                                    | Example code                                                                                            |
  | ---- | --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
  | 400  | input failed validation                 | `VALIDATION_FAILED` (details has `fieldErrors`), `INVALID_JSON`, `BODY_TOO_LARGE` (JSON body over 4 MB) |
  | 401  | not signed in or session expired        | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`                                                                |
  | 403  | not allowed, or cross-site request      | `ORIGIN_NOT_ALLOWED`, `WRONG_ACCOUNT_TYPE`, `PERMISSION_DENIED`                                         |
  | 404  | unknown route or wrong host             | `NOT_FOUND`                                                                                             |
  | 409  | conflict with current state             | `EMAIL_ALREADY_REGISTERED`, `PHONE_ALREADY_REGISTERED`                                                  |
  | 422  | valid input that breaks a business rule | e.g. unserviceable pincode                                                                              |
  | 429  | rate limit reached                      | `RATE_LIMITED` (header `Retry-After`, details `retryAfterSeconds`)                                      |
  | 500  | unexpected                              | `INTERNAL_ERROR` (details are never leaked)                                                             |
  | 503  | database transaction timed out          | `TRANSACTION_TIMEOUT` (nothing committed; header `Retry-After: 1`)                                      |

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

## Store: catalogue and search (`/api/store/*`, store host, Wave 6)

| Method | Path                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/store/categories`     | Active L1–L4 tree (Redis-cached, expired by every category change)                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/api/store/search`         | Query: `q`, `category` (slug, includes descendants), `brand` (repeat), `minPrice`/`maxPrice` (whole ₹), `inStock=true`, `rating` (1–4), `sort` (`relevance`, `price_asc`, `price_desc`, `newest`, `rating`), `page`, `attr.<code>` (repeat). Answers `{ products, totalCount, page, pageCount, facets, category, source }`; `source` is `postgres` while Elasticsearch is unreachable. Unknown category → 404 `CATEGORY_NOT_FOUND` |
| GET    | `/api/store/products/:slug` | Product page data with live `availableQuantity` per variant (summed over active warehouses, no warehouse named). Unknown or inactive → 404 `PRODUCT_NOT_FOUND`                                                                                                                                                                                                                                                                     |

## Store: cart (`/api/store/cart*`, store host, Wave 7)

Works for guests (cart in the httpOnly `store_guest_cart` cookie) and signed-in customers (saved cart);
the guest cart is merged into the saved cart on sign-in and registration. Every call answers with the whole
re-priced cart `{ cart: { lines[], itemCount, coupon, subtotalPaise, discountPaise, taxPaise,
shippingFeePaise, totalPaise, codFeePaise, freeShippingRemainingPaise, canCheckout } }`. Each line carries
`warnings` (`UNAVAILABLE`, `OUT_OF_STOCK`, `QUANTITY_EXCEEDS_STOCK`, `LOW_STOCK`, `PRICE_CHANGED`).

| Method | Path                               | Body                                   | Errors                                                                                                                                                                                                                             |
| ------ | ---------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/store/cart`                  | —                                      | —                                                                                                                                                                                                                                  |
| POST   | `/api/store/cart/items`            | `{ variantId, quantity }` (1–10) → 201 | 404 `VARIANT_NOT_FOUND`, 422 `VARIANT_UNAVAILABLE`, 409 `INSUFFICIENT_STOCK`, 422 `QUANTITY_LIMIT_EXCEEDED`, 422 `CART_FULL`                                                                                                       |
| PATCH  | `/api/store/cart/items/:variantId` | `{ quantity }`                         | as above, 404 `CART_LINE_NOT_FOUND`                                                                                                                                                                                                |
| DELETE | `/api/store/cart/items/:variantId` | —                                      | 404 `CART_LINE_NOT_FOUND`                                                                                                                                                                                                          |
| POST   | `/api/store/cart/coupon`           | `{ code }` (signed in)                 | 401 `SIGN_IN_REQUIRED`, 422 `COUPON_NOT_FOUND`, `COUPON_EXPIRED`, `COUPON_NOT_STARTED`, `COUPON_INACTIVE`, `COUPON_EXHAUSTED`, `COUPON_CUSTOMER_LIMIT_REACHED`, `COUPON_FIRST_ORDER_ONLY`, `COUPON_MIN_CART_NOT_MET`, `CART_EMPTY` |
| DELETE | `/api/store/cart/coupon`           | —                                      | 401 `SIGN_IN_REQUIRED`                                                                                                                                                                                                             |

## Store: checkout, orders and payment (`/api/store/*`, store host, signed-in customer, Waves 8–9)

| Method | Path                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/store/checkout/summary?addressId&paymentMethod` | Same pricing, coupon and courier rules as placing the order, without writing: `{ summary: { breakdown, coupon, courier, codLimitPaise, codFeePaise, issues } }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| POST   | `/api/store/checkout`                                 | Header `Idempotency-Key` (16–100 of `A-Z a-z 0-9 _ -`), body `{ addressId, paymentMethod: 'COD' \| 'ONLINE', expectedTotalPaise }`. 201 new order, 200 the same order for a repeated key and request. Errors: 400 `IDEMPOTENCY_KEY_REQUIRED`/`INVALID`, 403 `CUSTOMER_BLOCKED`, 409 `PRICE_CHANGED` (details.breakdown), 409 `CART_LINES_UNAVAILABLE`, 409 `OUT_OF_STOCK` (details.lines), 409 `COUPON_EXHAUSTED` or another coupon code, 422 `IDEMPOTENCY_KEY_REUSED`, `CART_EMPTY`, `ADDRESS_NOT_FOUND`, `PINCODE_NOT_SERVICEABLE`, `COD_NOT_AVAILABLE`, `COD_LIMIT_EXCEEDED`, `ORDER_TOO_LARGE` (subtotal beyond ₹2,14,74,836.47, the order row's range), `ONLINE_PAYMENT_UNAVAILABLE` (production: the simulated gateway is off), 409 `UNPAID_ORDERS_LIMIT` (ONLINE with 2 orders already awaiting payment), 429 `RATE_LIMITED` |
| GET    | `/api/store/orders?status&cursor`                     | Own orders, newest first, 10 per page, `nextCursor`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/api/store/orders/:orderId`                          | Items (snapshots), shipments with tracking events, payment with attempts, status history. Another customer's order → 404                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| POST   | `/api/store/orders/:orderId/cancel`                   | `{ reason }` (3–300). 204; 409 `CANCEL_NOT_ALLOWED` once anything has shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/api/store/orders/:orderId/payments`                 | Simulated gateway. Header `Idempotency-Key`; body `{ scenario: 'SUCCESS' \| 'DECLINE_INSUFFICIENT_FUNDS' \| 'DECLINE_BANK_UNAVAILABLE', amountPaise }`. 201 new attempt `{ attempt: { outcome, declineCode, message, paymentStatus, orderStatus, attemptsRemaining, isReplay } }`, 200 replay. 409 `PAYMENT_NOT_ONLINE`, `PAYMENT_ALREADY_COLLECTED`, `PAYMENT_CLOSED`, `PAYMENT_EXPIRED` (30-minute window; the order is cancelled), 422 `PAYMENT_AMOUNT_MISMATCH`, `IDEMPOTENCY_KEY_REUSED`, `ONLINE_PAYMENT_UNAVAILABLE` (production). The third decline cancels the order and releases its stock                                                                                                                                                                                                                                |

## Admin: pricing (`/api/admin/*`, admin host, Wave 7)

| Method    | Path                           | Permission       | Notes                                                                                                                                                                                                                          |
| --------- | ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET, PUT  | `/api/admin/settings`          | `settings.write` | `{ defaultTaxRateBasisPoints, shippingFeePaise, freeShippingThresholdPaise, codFeePaise, maxCodOrderValuePaise, returnWindowDays }`; audited `settings.updated` with before → after                                            |
| GET, POST | `/api/admin/coupons`           | `coupons.write`  | Create: `{ code, description, discountType: 'FLAT' \| 'PERCENT', discountValue, maxDiscountPaise, minCartPaise, validFrom, validUntil, totalUsageLimit, perCustomerLimit, firstOrderOnly, isActive }`; 409 `COUPON_CODE_TAKEN` |
| PUT       | `/api/admin/coupons/:couponId` | `coupons.write`  | Same fields without `code`; 409 `COUPON_LIMIT_BELOW_USAGE`                                                                                                                                                                     |

## Admin: orders, shipments and couriers (`/api/admin/*`, admin host, Wave 9)

| Method           | Path                                                      | Permission                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET              | `/api/admin/orders?q&status&paymentMethod&from&to&cursor` | `orders.read`                    | `q` = order number, email, phone or AWB (exact); dates are IST days, `to` inclusive                                                                                                                                                                                                                                                                                                                                                                               |
| GET              | `/api/admin/orders/:orderId`                              | `orders.read`                    | Detail plus the order's and its shipments' audit rows                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST             | `/api/admin/orders/:orderId/confirm`                      | `orders.write`                   | PLACED → CONFIRMED; an ONLINE order needs its payment collected (409 `PAYMENT_NOT_COLLECTED`)                                                                                                                                                                                                                                                                                                                                                                     |
| POST             | `/api/admin/orders/:orderId/cancel`                       | `orders.write`                   | `{ reason }`; 409 `CANCEL_NOT_ALLOWED`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| POST             | `/api/admin/shipments/:shipmentId/:action`                | `orders.write`                   | `pack`, `create-awb`, `ship` (dispatches stock), `out-for-delivery`, `deliver` (COD → COLLECTED when the order is delivered), `mark-failed`, `reattempt`, `initiate-rto` (COD → FAILED), `receive-rto` (restocks), `simulate-scan` (`{ outcome: 'DELIVERED' \| 'DELIVERY_FAILED' }`, answers `{ scan: { status } }`). Optional `{ reason }`. 409 `INVALID_TRANSITION`, `ORDER_NOT_CONFIRMED`, `NO_NEXT_SCAN`; 503 `COURIER_UNAVAILABLE` (shipment back to PACKED) |
| GET              | `/api/admin/shipments/:shipmentId/label`                  | `orders.read`                    | PDF label once the AWB exists                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| GET, POST        | `/api/admin/courier-partners`                             | `orders.read` / `couriers.write` | Create `{ code, name, priority, supportsCod, isActive }` (adapter is always `demo_courier`)                                                                                                                                                                                                                                                                                                                                                                       |
| PATCH            | `/api/admin/courier-partners/:courierPartnerId`           | `couriers.write`                 | Any of `name`, `priority`, `supportsCod`, `isActive`                                                                                                                                                                                                                                                                                                                                                                                                              |
| GET, PUT, DELETE | `/api/admin/courier-partners/:courierPartnerId/pincodes`  | `orders.read` / `couriers.write` | PUT `{ pincode, codAvailable, maxCodValuePaise, etaDays }`; DELETE `{ pincode }`                                                                                                                                                                                                                                                                                                                                                                                  |
| GET              | `/api/admin/courier-webhooks?before`                      | `orders.read`                    | Webhook log, 50 per page                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Courier webhook (`/api/webhooks/courier/:provider`, admin host)

POST with header `X-Courier-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` (secret
`COURIER_WEBHOOK_SECRET`; a fixed local secret in development and test). No Origin check (server to
server). Body `{ events: [{ eventId, awbNumber, status, description, location, occurredAt }] }`. Answers
`{ events: [{ providerEventId, result: 'PROCESSED' | 'DUPLICATE' | 'FAILED', message }] }`. 401
`WEBHOOK_SIGNATURE_INVALID` (missing, wrong or older than 5 minutes), 400 `WEBHOOK_PAYLOAD_INVALID`, 404
`COURIER_NOT_FOUND`. Each `(courier, eventId)` is applied at most once.

## Admin: customers, reports and audit (`/api/admin/*`, admin host, Wave 10)

| Method | Path                                                                      | Permission        | Notes                                                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/admin/customers?q&status&cursor`                                    | `customers.read`  | `q` = exact email or phone, or part of the name                                                                                                                                              |
| GET    | `/api/admin/customers/:customerId`                                        | `customers.read`  | Profile, addresses, `stats { orderCount, lifetimeValuePaise, rtoCount, cancelledCount }`, recent orders                                                                                      |
| POST   | `/api/admin/customers/:customerId/status`                                 | `customers.block` | `{ isBlocked, reason }`; blocking revokes every session; 409 `CUSTOMER_STATUS_UNCHANGED`                                                                                                     |
| GET    | `/api/admin/reports/dashboard?from&to`                                    | `reports.read`    | KPIs (orders, GMV, COD collected, paid online, AOV, cancellations, RTOs, returns), orders by day, by status, shipments by courier                                                            |
| GET    | `/api/admin/reports/summary?from&to`                                      | `reports.read`    | Top products and categories (from order-line snapshots), stock by warehouse, reconciliation `{ reportTotalPaise, orderTotalPaise, paymentTotalPaise, orderCount, paymentCount, isBalanced }` |
| GET    | `/api/admin/audit-logs?entityType&entityId&actorId&action&from&to&before` | `audit.read`      | Newest first, 50 per page, `nextBefore`; `action` is a prefix                                                                                                                                |

## Complete reference: Swagger UI (Wave 15, D49)

Every endpoint, with its request body schema, query parameters, required permission and success status, is
in `docs/openapi.json` (OpenAPI 3.1, generated from the route handlers by `npm run docs:openapi`; a unit
test fails when it is out of date). Signed-in staff can browse it in Swagger UI at
`http://admin.localhost:3000/docs`.

## Admin power tools (Wave 13)

| Method and path                                                         | Permission      | Notes                                                                                                                                                                   |
| ----------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/admin/inventory/transfers`                                   | inventory.write | D27. `Idempotency-Key` required; `{ fromWarehouseId, toWarehouseId, reason, lines[] }`; 201 (200 on replay), 409 `OUT_OF_STOCK`                                         |
| `POST /api/admin/tagging/recategorise`                                  | taxonomy.write  | D21. `{ fromCategoryId, toCategoryId }`; 200 `{ movedProductIds, archivedProductCount }`                                                                                |
| `GET /api/admin/staff`, `POST /api/admin/staff`                         | staff.manage    | D3. 201; 409 `STAFF_EMAIL_TAKEN`; 422 `ROLE_NOT_FOUND`                                                                                                                  |
| `PUT /api/admin/staff/{staffUserId}/roles`                              | staff.manage    | D3. 204; 409 `OWN_ACCOUNT` / `LAST_SUPER_ADMIN`                                                                                                                         |
| `POST /api/admin/staff/{staffUserId}/status`                            | staff.manage    | D3. `{ status: ACTIVE \| DEACTIVATED }`; deactivation revokes sessions                                                                                                  |
| `GET /api/admin/roles`                                                  | staff.manage    | D3. Role list for the staff form                                                                                                                                        |
| `GET /api/admin/search-index`                                           | search.manage   | D48. Index health and outbox backlog                                                                                                                                    |
| `POST /api/admin/search-index/sync`, `.../reindex`                      | search.manage   | D48. 409 `REINDEX_RUNNING`, 503 `SEARCH_UNAVAILABLE`                                                                                                                    |
| `GET /api/admin/reports/export/{orders\|sales\|gst-summary\|inventory}` | reports.read    | D8. CSV; `from`, `to` (IST days); 422 `EXPORT_TOO_LARGE`. `orders` lists customer names and emails, so it also needs `orders.read` and `customers.read` (403 otherwise) |
| `POST /api/admin/product-types/{productTypeId}/products/import`         | catalogue.write | D16. `{ csv }`; 200 `{ csvImport: { savedCount, createdProductCount, errors[] } }`; 422 `CSV_HEADER_INVALID`                                                            |
| `GET /api/admin/product-types/{productTypeId}/products/export`          | catalogue.read  | D16. CSV in the upload layout (empty type → template)                                                                                                                   |
| `POST /api/admin/courier-partners/{courierPartnerId}/pincodes/import`   | couriers.write  | D41. `{ csv }` with `pincode,cod_available,max_cod_value_rupees,eta_days`                                                                                               |
| `GET /api/admin/docs/openapi.json`, `/api/admin/docs/assets/{file}`     | any staff       | D49. The generated document and the self-hosted Swagger UI script                                                                                                       |

## Rate limits added on 2026-11-15

- `GET /api/store/search` and `GET /api/store/search/suggest`: 429 `RATE_LIMITED` past the `public-search`
  policy (per client IP; not applied while the client IP is unknown, i.e. `trustedProxyHopCount` 0).
- `POST /api/store/reviews`: 429 `RATE_LIMITED` past the `review-write` policy (per customer).
- `POST /api/webhooks/courier/{provider}`: a body over 64 KB is refused (400 `WEBHOOK_TOO_LARGE`) from its
  Content-Length, before it is read.

## Changes on 2026-11-15 (TD-033)

- `PATCH /api/store/account/profile`: body may include `currentPassword`; it is required when `phone`
  changes (400 `CURRENT_PASSWORD_REQUIRED` or `CURRENT_PASSWORD_INCORRECT`, with `details.fieldErrors`;
  429 after repeated wrong passwords). A phone change signs out the customer's other sessions.
- `POST /api/webhooks/courier/{provider}`: `X-Courier-Signature` is now computed with that partner's key,
  `HMAC-SHA256(COURIER_WEBHOOK_SECRET, "courier-webhook:v1:{provider}")`, not the master secret.
