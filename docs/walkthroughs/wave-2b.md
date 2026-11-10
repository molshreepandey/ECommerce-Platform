# Wave 2B walkthrough: accounts, sessions, roles, addresses and the audit trail

This is a study guide for the code added in Wave 2B. Read it next to the files. Each section explains why
the code exists, how the important lines work, and how to try it yourself. The decisions behind it are in
`docs/TECHNICAL_DECISIONS.md` (TD-009 and TD-011 to TD-015).

---

## 0. The big picture: one sign-in, end to end

```
Browser                      proxy.ts               route handler            service                     PostgreSQL
───────                      ────────               ─────────────            ───────                     ──────────
POST /api/store/auth/login ─▶ host → "store"  ─────▶ apiHandler:             loginCustomer:
  Origin: store origin         adds x-request-id      1. origin check          1. rate limit (Redis/PG)
  {email, password}                                   2. parseJsonBody (Zod)   2. find account by email ──▶ SELECT
                                                                               3. Argon2id verify
                                                                               4. startSession ─────────▶ INSERT sessions
                                                      3. setSessionCookie ◀─── {sessionToken, expiresAt}   (token_hash only)
◀── 200 + Set-Cookie: store_session=<token>; HttpOnly; SameSite=Lax

GET /account (page) ────────▶ cookie present? ───▶ page (Server Component)
                               no → 307 /login      <Suspense> → currentCustomerOrRedirect()
                                                     reads cookies(), hashes token ──────────────────▶ SELECT … JOIN customers
```

Layers (rule T1 in the traceability matrix):

| Layer          | Files                                                   | May import                   |
| -------------- | ------------------------------------------------------- | ---------------------------- |
| Pages and UI   | `src/app/**/page.tsx`, `src/components/**`              | services, schemas, `src/lib` |
| Route handlers | `src/app/api/**/route.ts` (5–15 lines each)             | services, schemas, `src/lib` |
| Services       | `src/modules/identity/*.service.ts`, `audit.service.ts` | repositories, other services |
| Repositories   | `src/modules/identity/*.repository.ts`                  | Prisma only                  |

Route handlers never touch Prisma. Services own transactions, and repositories accept either the
client or a transaction (`DatabaseClient`) so a service can run several of them in one transaction.

---

## 1. Passwords: `src/modules/identity/password-hasher.ts`

```ts
export function hashPassword(password: string): Promise<string> {
  return hash(password, hashingOptions()); // Argon2id, 19,456 KiB, 2 passes, 1 lane
}
```

- `hash` runs on Node's worker pool, so a 10–25 ms hash does not freeze other requests (TD-009 measured it).
- The output is a self-describing string: `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`. `verify` reads
  the parameters back from it, so raising the cost later does not break existing hashes.
- `verifyPassword` returns `false` instead of throwing for a malformed hash (for example the old seed
  placeholder), so bad data can never crash sign-in.
- `verifyAgainstDummyHash` is used when the email is unknown: it spends the same time as a real check.
  Without it, "unknown email" would answer about 10 ms faster than "wrong password", and an attacker
  could tell which emails are registered by timing.

**Try it:** `npm test -- password-hasher` (5 tests: format, wrong password, a different salt for every hash, malformed hash, dummy hash).

---

## 2. Session tokens: `session-token.ts`, `session.repository.ts`, `session.service.ts`

```ts
randomBytes(32).toString('base64url'); // 256 random bits → 43 characters
createHash('sha256').update(sessionToken).digest('hex'); // what the database stores
```

- **Why hash the token?** If the `sessions` table ever leaks (a backup, a log, a SQL injection), the
  attacker gets hashes, not working cookies. SHA-256 is enough here (unlike passwords) because the token is
  256 random bits; nobody can guess it, so a slow hash adds nothing.
- `startSession(database, subject)` takes the transaction client. Registration creates the customer, the
  audit row and the session in **one** transaction: if any step fails, none of them exist.
- `findActiveSessionByTokenHash` is a single SQL query:

  ```sql
  FROM sessions s
  LEFT JOIN customers c   ON s.subject_type = 'CUSTOMER' AND c.id = s.subject_id
  LEFT JOIN staff_users su ON s.subject_type = 'STAFF'   AND su.id = s.subject_id
  WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
  ```

  It checks the token, sign-out, expiry and the account status (`ACTIVE`) in one indexed lookup. Blocking
  a customer therefore ends their existing sessions on the very next request.

- Sign-out sets `revoked_at` (it does not delete), so the history remains for support and auditing.

---

## 3. Cookies: `src/lib/session-cookie.ts`

```ts
response.cookies.set({
  name,
  value: sessionToken,
  httpOnly: true,
  sameSite: 'lax',
  secure: config.secureCookies,
  path: '/',
  expires: session.expiresAt,
});
```

| Flag             | What it stops                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `HttpOnly`       | JavaScript (including injected scripts) cannot read the token                                                             |
| `SameSite=Lax`   | other sites cannot send it with their form posts (our `Origin` check is a second line)                                    |
| `Secure` (prod)  | the cookie never travels over plain HTTP                                                                                  |
| `__Host-` (prod) | the browser refuses the cookie unless it is Secure, `Path=/` and has no `Domain`; a sibling subdomain cannot overwrite it |
| no `Domain`      | the store cookie is never sent to the admin host and vice versa                                                           |

Two cookie names (`store_session`, `admin_session`) keep the two sites independent: you can be signed in
as a customer and as staff in the same browser.

---

## 4. Who is calling? `access-control.ts` and `current-session.ts`

```ts
export async function customerFromSessionToken(token) { … }   // shared core
export function requireCustomer(request) {                     // route handlers
  return customerFromSessionToken(readSessionToken(request, 'store'));
}
export async function currentCustomerOrRedirect(nextPath) {    // Server Components
  … customerFromSessionToken((await cookies()).get(name)?.value ?? null) …
}
```

| Situation                                    | API answer                                     | Page behaviour       |
| -------------------------------------------- | ---------------------------------------------- | -------------------- |
| no cookie, unknown, expired or revoked token | 401 `UNAUTHENTICATED`                          | redirect to `/login` |
| account blocked or deactivated               | 401                                            | redirect             |
| customer token on the admin site             | 403 `WRONG_ACCOUNT_TYPE`                       | redirect             |
| staff without the needed permission          | 403 `PERMISSION_DENIED` + `requiredPermission` | (Wave 3+)            |

`requireStaff` loads the staff member's permission codes (role → role_permissions → permissions) on every
request. `requirePermission(request, 'orders.read')` is what later waves call at the top of each admin
handler. The admin navigation uses the same codes to hide links (`visibleNavigationItems` in
`src/app/admin/admin-shell.ts`). Hiding a link is only convenience; the API check is the security.

---

## 5. Redirects in the proxy: `sign-in-redirect.ts` and `safe-next-path.ts`

`src/proxy.ts` runs before every page. It now asks one question: **does a session cookie exist?**

- Store: `/account` and `/account/...` without a cookie → `307 /login?next=/account/...`.
- Admin: **every** page except `/login` without a cookie → `307 /login`. This is deny-by-default: a page
  added in Wave 6 is protected without anyone remembering to add it to a list.

The proxy does not query the database. A made-up cookie gets past it, and the page then verifies the
session and redirects. This keeps the proxy fast and keeps one source of truth for "is this session valid".

`safeNextPath` stops an _open redirect_: without it, `/login?next=https://evil.example` would send a freshly
signed-in user to a phishing page. Only paths starting with a single `/` are accepted (`//evil.example` is
a protocol-relative URL, so it is rejected too).

---

## 6. Registration and sign-in: `customer-account.service.ts`

```ts
await enforceRateLimit({ action: 'customer-register', identifier: clientIp ?? 'unknown-client' });
const passwordHash = await hashPassword(input.password);      // slow work outside the transaction
try {
  return await db.$transaction(async (tx) => {
    const customer = await insertCustomer(tx, …);
    await recordAuditEvent(tx, { action: 'customer.registered', after: { email, fullName } … });
    const session = await startSession(tx, …);
    return { customer, session };
  });
} catch (error) { throw toConflictError(error); }            // P2002 → 409
```

- **Duplicate emails under a race.** Two requests can both check that an email is free and then both insert.
  So the code does not check first: it inserts, and the `UNIQUE` index on `customers.email` decides. The loser gets Prisma
  error `P2002`; `toConflictError` reads the constraint name (`customers_email_key` or
  `customers_phone_key`) and turns it into 409. The integration test fires 10 registrations at once
  (half with upper-case emails) and gets exactly 1 account, 1 session and 1 audit row.
- **Why lower-case?** The Zod schema lower-cases emails, and a database CHECK constraint
  (`customers_email_lowercase_check`) refuses anything else, so `Asha@x` and `asha@x` can never be two
  accounts even if some future code forgets to normalise.
- **Hash outside the transaction:** a transaction holds a database connection; spending 20 ms of CPU while
  holding it would waste the pool.
- **Sign-in:** every failure (unknown email, wrong password, blocked) throws the same
  `InvalidCredentialsError`. The status check comes _after_ the password check, so a blocked account is
  only distinguishable to someone who already knows its password.

---

## 7. Staff sign-in and failure auditing: `staff-account.service.ts`

Success runs in one transaction: `last_login_at`, the `staff.login_succeeded` audit row, the session.

Failures are audited too, outside any transaction because nothing else changes:

```json
{
  "action": "staff.login_failed",
  "actorType": "SYSTEM",
  "entityId": "<staff id or 'unknown'>",
  "after": { "email": "support@demo-store.test", "reason": "WRONG_PASSWORD" }
}
```

The reason (`UNKNOWN_EMAIL`, `WRONG_PASSWORD`, `ACCOUNT_DEACTIVATED`, or `DEMO_CREDENTIAL_REFUSED` outside
development and test, section 13) helps an administrator spot an attack
or a locked-out colleague, while the client still sees the identical 401.

---

## 8. Addresses and the row lock: `address.service.ts`

The rule "at most one default address per customer" is enforced twice:

1. **Database:** a partial unique index, `UNIQUE (customer_id) WHERE is_default`. A second default
   for the same customer is impossible no matter what the code does.
2. **Service:** every change that touches the default first runs

   ```sql
   SELECT id FROM customers WHERE id = $1 FOR UPDATE
   ```

   This locks _that customer's row_ until the transaction ends. Two "make default" clicks from two tabs
   then run one after the other instead of interleaving. Without the lock, the second would hit the unique
   index and fail with an error. With it, both succeed and the last one wins. Other customers are not
   blocked.

The integration tests prove it: 10 parallel "create as default" → 10 addresses and exactly 1 default; 10
parallel "make default" calls across 5 addresses → all succeed, exactly 1 default.

Other rules:

- The first address becomes the default automatically.
- Archiving the default promotes the newest remaining address.
- Archived addresses are kept (`archived_at`), never deleted, because past orders copy the address and
  later reports may refer to it.
- Every query filters by `customer_id`, so someone else's address id answers 404, exactly like a missing
  one; it never reveals that the id exists.

---

## 9. The audit writer: `src/modules/audit/audit.service.ts`

```ts
const sensitiveKeyPattern = /pass(word)?|hash|token|secret|otp|cookie|session|credential/i;
```

- `recordAuditEvent(tx, event)` takes the transaction client, so the audit row commits or rolls back with
  the change. The test "rolls the audit row back together with the change it describes" throws after
  writing both and checks that neither exists.
- Keys matching the pattern are removed before writing. A test caught that this also removed the
  harmless `revokedSessionCount`, so the key became `revokedCount`. When the filter is too strict, rename
  the key; never loosen the filter.
- `AuditData` is flat (string, number, boolean or null values), so a secret cannot hide inside a nested
  object.
- Addresses are audited as "which fields changed, plus city and pincode", never the street or phone.

---

## 10. Route handlers: thin on purpose

```ts
export const POST = apiHandler(async (request, _routeContext, requestContext) => {
  const input = await parseJsonBody(request, loginSchema); // 400 INVALID_JSON / VALIDATION_FAILED
  const { customerId, session } = await loginCustomer(
    input,
    requestMetadata(request, requestContext),
  );
  const response = NextResponse.json({ customer: { id: customerId } });
  setSessionCookie(response, 'store', session);
  return response;
});
```

`apiHandler` (Wave 2A) already does the origin check, request id, logging and error-to-envelope mapping.
A handler only parses, calls one service function and shapes the response. Dynamic segments are
validated too: `z.uuid().parse(params.addressId)` turns `/addresses/not-a-uuid` into a 400 instead of a
database error.

---

## 11. Pages and forms

**Server pages with `<Suspense>` (Next 16 Cache Components).** `src/app/store/account/page.tsx`:

```tsx
<Heading level={1}>Your account</Heading>        {/* static: prerendered at build time */}
<Suspense fallback={<Skeleton … />}>
  <AccountDetails />                              {/* reads the cookie at request time */}
</Suspense>
```

The build output marks these pages `◐ (Partial Prerender)`: the shell is static HTML, and the signed-in part
streams in. Reading `cookies()` outside a `<Suspense>` boundary is a build error with Cache Components;
the Next 16 guide `authentication-with-cache-components.md` describes this pattern.

**Forms** (`src/components/organisms/*`) are Client Components:

- Every form validates with the **same Zod schema** as the server (`identity.schema.ts`), so the shopper
  sees "Enter a 10-digit mobile number…" before any request, and the server still re-validates.
- `noValidate` turns off the browser's own pop-ups so errors appear in one consistent, accessible way.
- `FormField` links the label (`htmlFor`), the hint and the error (`aria-describedby`) and sets
  `aria-invalid`, so a screen reader announces "Mobile number, invalid, 10 digits, without +91, Enter a
  10-digit…". The browser test checks exactly this accessible description.
- `PasswordField` adds a Show/Hide button with `aria-pressed`.
- After a change, `router.refresh()` re-renders the server part with fresh data; there is no client-side
  copy of the address list to drift out of date.
- Destructive actions (remove an address, sign out everywhere) go through `ConfirmDialog` (Radix Dialog:
  focus trap, Escape to close, focus returns to the button).

---

## 12. Tests: what each one proves

| File                                                 | Proves                                                                                                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/integration/customer-accounts.test.ts`        | registration stores Argon2id + session + 1 audit row; 409 in any case; 10-way race → 1 account; identical 401s; 429 with Retry-After; logout-everywhere scope; profile audit before/after     |
| `tests/integration/staff-login.test.ts`              | all 5 seeded roles sign in with exactly their role's permissions; each failure reason audited; customer cannot sign in as staff                                                               |
| `tests/integration/addresses.test.ts`                | default rules, both concurrency races, promotion on archive, 404 for others' addresses, audit without street or phone                                                                         |
| `tests/integration/sessions-and-access.test.ts`      | token hashing, lifetimes, expiry, revocation, blocked/deactivated, 403 for the wrong site, permissions, audit rollback                                                                        |
| `tests/integration/identity-constraints.test.ts`     | the migration is applied; lower-case emails and the Indian mobile format are enforced by the database for customers, staff and addresses                                                      |
| `tests/integration/demo-credentials-refused.test.ts` | with demo accounts switched off: every demo sign-in gets the ordinary 401, the demo password is refused on any email, staff refusals are audited, registration with demo credentials gets 400 |
| `tests/integration/client-ip-trust.test.ts`          | behind one trusted proxy, forged `X-Forwarded-For` entries cannot open new rate-limit buckets or reach the audit trail (section 15)                                                           |
| `tests/http/client-ip.http.test.ts`                  | with no trusted proxy, the running server ignores forged `X-Forwarded-For` headers                                                                                                            |
| `tests/http/identity.http.test.ts`                   | the real HTTP stack: cookie flags, origin check (wrong, missing, other site), envelopes, byte-identical 401s, account separation, redirects                                                   |
| `e2e/customer-account.spec.ts`                       | a real browser does the whole journey at desktop and 360 px with no CSP violations                                                                                                            |
| `e2e/admin-sign-in.spec.ts`                          | each staff role signs in and out; keyboard-only sign-in; generic error                                                                                                                        |

**Try it yourself** (dev server running, `npm run dev`):

```bash
# 1. Sign in and keep the cookie
curl -i -c /tmp/jar -H 'Origin: http://store.localhost:3000' -H 'Content-Type: application/json' \
  -d '{"email":"asha.verma@demo-store.test","password":"DemoPass!2026"}' \
  http://store.localhost:3000/api/store/auth/login
# 2. Use it
curl -b /tmp/jar http://store.localhost:3000/api/store/account/addresses
# 3. Same request from a "different site": 403 ORIGIN_NOT_ALLOWED
curl -i -b /tmp/jar -X POST -H 'Origin: http://evil.example' http://store.localhost:3000/api/store/auth/logout-all
# 4. Then look at what was recorded (no password, no token):
docker compose exec postgres psql -U ecommerce -d ecommerce -c \
  "select action, after, ip_address from audit_logs order by created_at desc limit 5"
```

---

## 13. Keeping the demo password out of production: `demo-credentials.ts`

The demo password is public (it is in the README), so it must never work on a real deployment. There are
two independent layers, so one mistake is not enough:

```ts
assertDemoCredentialsAllowed(process.env['APP_ENV']); // seed: only "development" or "test"
demoCredentialsPermitted({ configAllows, appEnvironment }); // sign-in: config flag AND APP_ENV must agree
```

- **An allowlist, not a denylist.** The first version refused only `"production"`, so `"staging"`, `"prod"`
  or an empty value would have seeded the demo accounts. Listing what is _allowed_ fails safe.
- **No default parameter.** `assertDemoCredentialsAllowed(appEnvironment = process.env.APP_ENV)` looked
  neat, but calling it with `undefined` silently used the default instead of refusing. A unit test caught
  it, and the environment is now passed explicitly.
- **Runtime layer.** Even if demo rows reach a production database, `@demo-store.test` emails and the demo
  password get the ordinary 401 (registration gets 400). The check sits before the password check and
  runs a dummy hash, so it does not change response times.

## 14. Things that went wrong while building this (and what they teach)

| What happened                                                               | Lesson                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Prisma's P2002 error had no `target` field with the pg adapter              | measure the real error shape and parse it with Zod rather than trusting memory or old docs |
| The audit filter silently dropped `revokedSessionCount`                     | assert on what was _stored_, not on what was passed in                                     |
| A test built an array of promises; later ones rejected before being awaited | wrap each call in a function (`() => call()`) when you want to run them one at a time      |
| Playwright found two "Email" fields after a client navigation               | Next 16 keeps the previous page mounted but hidden (`<Activity>`); match visible elements  |
| `getByText('Default')` also matched the "Make default" button               | Playwright text matching is case-insensitive and partial unless `exact: true`              |
| A second full seed run changes `updated_at` in 25 tables                    | changing live data needs a targeted, verified `UPDATE`, not "just re-run the seed"         |

---

## 15. Which IP address is the client? `src/lib/client-ip.ts` (final check 7)

Rate limits (`ip|email` for sign-in, `ip` for registration) and the audit trail need the caller's IP.
Behind a proxy, the app sees the proxy's address, so the client's address comes from `X-Forwarded-For`.

- **The trap:** each proxy **appends** the address it received the connection from, so the header reads
  `<whatever the client sent>, <real client>`. The first version took the **leftmost** entry, which the
  client controls. Behind such a proxy, a forged address on every request meant a fresh rate-limit bucket
  every time: unlimited password guesses, no registration limit, and a fake IP in the audit trail.
- **The fix:** `authentication.trustedProxyHopCount` says how many proxies we control. The client is the
  entry that many places from the **right**. With `0` the header is never read. If the entry is missing
  or not an IP, the answer is "unknown", never another entry.
- **Why `0` everywhere today:** without a proxy in front, Next.js passes a client-supplied header through
  unchanged (it only fills it in when it is absent), so trusting it would be unsafe. Staging and
  production stay at `0` until the real hosting setup is verified; setting it is a deployment requirement
  (DEPLOYMENT_GUIDE, TD-015, L4).
- **How it was proved:** the tests in `client-ip-trust.test.ts` were written first and failed on the old
  code (the over-limit sign-in got 401 instead of 429, and the audit row stored the forged address), then
  passed after the fix.

**Try it:** `npm test -- client-ip`, then
`npx vitest run --config vitest.integration.config.ts tests/integration/client-ip-trust.test.ts`.
