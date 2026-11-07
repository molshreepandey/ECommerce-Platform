# API documentation

Status: conventions and the health endpoint. Feature endpoints are added per wave; the plan generates an
OpenAPI 3.1 document and a Swagger UI from the Zod schemas in Wave 15.

## Conventions

- **Hosts:** store APIs under `/api/store/*` on the store host; admin APIs under `/api/admin/*` on the admin
  host; the other host returns 404 with the error envelope.
- **Error envelope:** every error response is
  `{ "error": { "code": "STRING_CODE", "message": "Human readable", "details": … } }`.

  | HTTP | When                                    | Example code                                                       |
  | ---- | --------------------------------------- | ------------------------------------------------------------------ |
  | 400  | input failed validation                 | `VALIDATION_FAILED` (details has `fieldErrors`)                    |
  | 401  | not signed in or session expired        | from Wave 2B                                                       |
  | 403  | not allowed, or cross-site request      | `ORIGIN_NOT_ALLOWED`                                               |
  | 404  | unknown route or wrong host             | `NOT_FOUND`                                                        |
  | 409  | conflict with current state             | e.g. out of stock (Wave 8)                                         |
  | 422  | valid input that breaks a business rule | e.g. unserviceable pincode                                         |
  | 429  | rate limit reached                      | `RATE_LIMITED` (header `Retry-After`, details `retryAfterSeconds`) |
  | 500  | unexpected                              | `INTERNAL_ERROR` (details are never leaked)                        |

- **Same-origin rule:** `POST`, `PUT`, `PATCH` and `DELETE` must send an `Origin` header equal to the site's
  public origin (for example `http://store.localhost:3000`); otherwise 403 `ORIGIN_NOT_ALLOWED`.
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
