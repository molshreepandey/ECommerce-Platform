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

- **Same-origin rule:** `POST`, `PUT`, `PATCH` and `DELETE` must send an `Origin` header equal to the site's
  public origin (for example `http://store.localhost:3000`); otherwise 403 `ORIGIN_NOT_ALLOWED`.
- **Sessions:** sign-in sets an `HttpOnly`, `SameSite=Lax` cookie: `store_session` on the store host,
  `admin_session` on the admin host (`__Host-` prefixed and `Secure` in staging and production). Browsers
  send it automatically; API clients send it as a `Cookie` header. See TD-011.
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
