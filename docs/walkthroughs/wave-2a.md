# Wave 2A walkthrough: configuration, Redis, rate limiting, test harness, security

This is a study guide for the code added in Wave 2A. Read it next to the files. Each section explains why
the file exists, what its important lines do, and shows an example.

---

## 1. Configuration: `src/lib/config/`

### Why it exists

Hard-coded values (hosts, timeouts, limits) make an app impossible to run in several environments. Secrets
in files leak. So we split settings into two kinds:

- **Non-secret settings** → `config/config.<APP_ENV>.json`, committed to Git, reviewed like code.
- **Secrets and connection strings** → environment variables (`.env` locally, platform settings in
  staging and production), never committed.

### `config.schema.ts`

```ts
const surfaceSchema = z.strictObject({ hosts: z.array(hostWithOptionalPort).min(1), publicOrigin: z.url(...) });
```

- `z.strictObject` rejects **unknown keys**. If someone types `"loging"` instead of `"logging"`, start-up
  fails with `loging: Unrecognized key` instead of silently ignoring the setting.
- `.refine(...)` at the end checks a rule across fields: the store and admin sites must not share a host
  (otherwise `proxy.ts` could not tell them apart).
- `export type AppConfig = z.infer<typeof appConfigSchema>`: the TypeScript type is **derived** from the
  schema, so the type and the validation can never disagree (plan rule 23).

### `load-config.ts`

```ts
export function resolveConfigFilePath({ appEnvironment, explicitConfigFilePath, projectRoot }) {
  if (explicitConfigFilePath !== undefined) return path.resolve(explicitConfigFilePath);
  return path.join(projectRoot, 'config', `config.${appEnvironment}.json`);
}
```

- `APP_CONFIG_PATH` wins if set; otherwise `config/config.<APP_ENV>.json` under the project root.
- `loadConfigFile` reads the file with `readFileSync`, parses JSON and validates. Any failure becomes an
  `InvalidConfigError` that lists every problem, for example:

  ```
  Invalid configuration in /tmp/broken-config.json:
    surfaces.store: Invalid input: expected object, received undefined
  ```

### `index.ts` → `getConfig()`

Reads and validates **once**, then returns the cached object. The first call happens at server start
(`src/instrumentation-node.ts`), so a broken file stops the server before it serves anything.

### Build-time vs runtime (the important idea)

`next build` freezes anything that is imported into code. Our config is **read from disk when the server
starts**, so the same build works everywhere:

```
Same .next build ──► APP_ENV=staging     → reads config.staging.json
                 └─► APP_ENV=production  → reads config.production.json
```

Example from the verification run: one build served `store.localhost`; restarted with
`APP_CONFIG_PATH` pointing at a file with host `shop.localhost`, the same build (same `BUILD_ID`) served
`shop.localhost` and returned 404 for `store.localhost`.

### `src/instrumentation.ts` and `instrumentation-node.ts`

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { validateStartupConfiguration } = await import('./instrumentation-node');
  validateStartupConfiguration();
}
```

Next.js calls `register()` once at start-up, for both the Node.js and the Edge runtime. Edge has no file
system, so the Node-only code is loaded with a dynamic `import()` only on Node. `validateStartupConfiguration`
calls `process.exit(1)` on invalid configuration, so a deployment fails loudly instead of answering 500.

---

## 2. Redis client: `src/lib/redis.ts`

### Why it exists

One place that creates the Redis connection, applies timeouts, and turns every failure into a single error
type (`RedisUnavailableError`) that callers can fall back on.

### Key lines

```ts
const client = createClient({
  url: getEnvironment().REDIS_URL,
  disableOfflineQueue: true,
  socket: { connectTimeout, reconnectStrategy: (retries) => Math.min(50 * 2 ** retries, maxDelay) },
});
client.on('error', logConnectionError);
```

- `disableOfflineQueue: true`: while disconnected, commands fail immediately instead of waiting in a queue
  until Redis returns. We want "fail fast, fall back to Postgres".
- `reconnectStrategy`: exponential back-off (50 ms, 100 ms, 200 ms … capped). The client keeps trying to
  reconnect in the background.
- `client.on('error', …)` is required: Node.js crashes the process on an unhandled `'error'` event. The
  handler logs at most once every 30 s so an outage does not flood the logs.

```ts
export async function runRedisCommand(command) {
  const client = await getReadyRedisClient();
  const pendingCommand = command(client);
  pendingCommand.catch(() => undefined);
  … Promise.race([pendingCommand, replyDeadline]) …
  catch (error) { if (error instanceof RedisUnavailableError) { openCircuit(); discardClient(client); } throw error; }
}
```

- **Why our own deadline?** We measured node-redis 6.3.1 with Redis frozen (`docker compose pause`): its
  command timeout and abort signal did not cancel a command that had already been sent. A frozen Redis
  would have stalled requests indefinitely. So `Promise.race` gives up after `replyTimeoutMilliseconds`.
- `pendingCommand.catch(() => undefined)`: when we give up, the original command may still reject later.
  Without this line that late rejection would be "unhandled" and could crash the process.
- `discardClient`: a connection that stopped answering cannot be trusted; the next call builds a new one.
- `openCircuit()`: for `failureCooldownMilliseconds` (5 s) callers do not even try Redis; they fall back
  straight away. This is a small **circuit breaker**.

### Timeline example (Redis frozen)

```
t=0 ms     request A → Redis call sent, no reply
t=500 ms   deadline → RedisUnavailableError, client discarded, circuit open until t=5500
t=510 ms   request B → circuit open → RedisUnavailableError immediately (0 ms wait) → Postgres
t=5600 ms  request C → circuit closed → new client tries to connect (up to 500 ms)
```

---

## 3. Rate limiting: `src/lib/rate-limit/`

### The idea (fixed window)

"At most 5 login attempts per 60 seconds per IP + email." Time is cut into 60-second windows; each window
has its own counter.

```
nowMilliseconds = 12:00:30.000
windowStartedAt = floor(now / 60 000) × 60 000 = 12:00:00.000
retryAfterSeconds = 12:01:00 − 12:00:30 = 30
```

### `rate-limit-window.ts`

```ts
const identifierHash = createHash('sha256').update(identifier).digest('hex');
return `${action}:${identifierHash}`;
```

The identifier (IP, email) is **hashed**, so Redis keys and database rows never contain personal data.

### `redis-rate-limit-store.ts`: the Lua script

```lua
local requestCount = redis.call('INCR', KEYS[1])
if requestCount == 1 or redis.call('PTTL', KEYS[1]) == -1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return requestCount
```

- Redis runs a Lua script **atomically**: no other command runs in the middle. That is why 50 parallel
  requests got exactly the counts 1…50 in the integration test, and exactly 5 were allowed.
- `INCR` creates the key at 1 if missing and returns the new count.
- `PEXPIRE` sets the expiry on the first increment. `PTTL == -1` means "exists without expiry"; the script
  repairs that so a counter can never live forever.
- The reply is validated with Zod (`z.int().min(1)`) because the client types replies loosely.

### `rate-limit.repository.ts`: the Postgres fallback

```sql
INSERT INTO rate_limit_counters (bucket_key, window_started_at, request_count)
VALUES ($1, $2, 1)
ON CONFLICT (bucket_key, window_started_at)
DO UPDATE SET request_count = rate_limit_counters.request_count + 1
RETURNING request_count
```

- One statement, atomic: when two requests race, Postgres locks the conflicting row and applies the second
  update after the first. `RETURNING` gives back the new count without a second query (plan §10 rule 4).
- Proven in the integration test: 50 parallel calls → one row with `request_count = 50`, exactly 5 allowed.

### `rate-limit.ts`

- `createRateLimiter({ primaryStore, fallbackStore, … })` is **dependency injection**: the stores are
  passed in, so unit tests can pass fake stores (including ones that fail) without stopping containers.
- If the primary store throws, the fallback store is used; if that also throws, the error propagates and
  the request fails. A security control should not silently switch itself off.
- `enforceRateLimit({ action, identifier })` reads the policy from config and throws
  `RateLimitExceededError` (HTTP 429). That error overrides `responseHeaders()` to add `Retry-After`, and
  `apiHandler` copies those headers onto the response.

---

## 4. Security headers and the same-origin check

### `src/lib/security-headers.ts` (runtime) and `next.config.ts` (build time)

- The Content-Security-Policy tells the browser where scripts, images, frames and connections may come
  from. Example for the store in development:

  ```
  default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' https://picsum.photos …;
  frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
  ```

- `'unsafe-eval'` is added only for the development server (React Refresh needs it).
- `frame-ancestors 'none'` stops other sites from embedding our pages (clickjacking).
- HSTS (`Strict-Transport-Security`) is sent only when the site's public origin is `https://`; sending it
  on plain-http localhost would be wrong.
- Why no nonce? Next 16 documents that nonces need every page rendered per request, which would switch off
  static rendering. The trade-off is recorded in TD-006.

### `src/lib/request-origin.ts`

```ts
if (!stateChangingMethods.has(method)) return { allowed: true };
if (originHeader === null) return { allowed: false, reason: 'ORIGIN_MISSING' };
return originHeader === surfaces[surface].publicOrigin
  ? { allowed: true }
  : { allowed: false, reason: 'ORIGIN_MISMATCH' };
```

Browsers send an `Origin` header on cross-site `POST`s. Comparing it **exactly** with our configured origin
blocks a malicious page from submitting a form to our API with the user's cookies (CSRF). Exact comparison
also defeats look-alikes such as `http://store.localhost:3000.evil.example.com`.

### `src/proxy.ts`

Every response the proxy returns (pages, APIs, 404s) gets the runtime headers through `withHeaders(...)`.
Requests for unknown hosts get the strictest policy, `default-src 'none'`.

---

## 5. Test harness: never touching the development database

### `tests/support/test-target-guard.ts`

```ts
const testDatabaseNamePattern = /^[a-z0-9_]+_test$/;
```

- The **database name** (parsed from the URL path) must end with `_test`. Tricks that would fool a simple
  "contains `_test`" check are rejected: `x_test` as the user name, `?db=x_test` in the query string,
  `ecommerce_test_backup`, `ecommerce_TEST`.
- After connecting, `SELECT current_database()` must also end with `_test`, which catches a proxy or pooler
  that routes a "correct" URL to the wrong database.
- Redis clean-up requires a key prefix ending in `test:` and deletes only matching keys with `SCAN` +
  `UNLINK`, never `FLUSHDB` (which would wipe everything).

### `tests/support/test-database-setup.ts`

Guard → create the test database if it does not exist → guard again → `prisma migrate deploy` with
`DATABASE_URL` pointing at the test database → check `current_database()`. Used by both the integration
tests' global setup and `npm run start:test`.

### `tests/integration/database-constraints.test.ts`: the concurrency proof

```ts
const updatedRowCounts = await Promise.all(
  Array.from({ length: 20 }, () => reserveOneUnit(variantId, warehouseId)),
);
expect(updatedRowCounts.filter((count) => count === 1)).toHaveLength(7);
```

Twenty requests try to reserve one unit at the same moment, with 7 units on hand. The guarded `UPDATE …
WHERE on_hand_quantity - reserved_quantity >= 1` is evaluated under a row lock: each update waits for the
previous one, re-checks the condition, and updates only if stock is still there. Result: exactly 7 succeed,
13 change 0 rows, and the table shows reserved = 7, available = 0. This is the same mechanism checkout will
use in Wave 8.

---

## 6. How to trace a failing request

1. Every response has an `x-request-id` header (also accepted from the client).
2. Every log line written while handling that request contains `"requestId"` with the same value.
3. Search the server log for that id to see the route, duration, and any `domain error` or `unhandled error`
   entry with its stack trace. Redis problems appear as `redis connection error` or
   `rate limit store fallback` (with `fallbacksSinceLastLog`).

---

## 7. Questions you may be asked

- _Why is the same build safe to promote from staging to production?_ Settings are read at start-up from
  `APP_ENV`'s file; nothing environment-specific is frozen into the build.
- _What happens if Redis is down during login?_ The rate limiter falls back to Postgres; health shows
  `degraded`; at most one request per 5 s waits ~0.5 s for Redis.
- _How do you know the rate limiter is atomic?_ Lua scripts run atomically in Redis and
  `INSERT … ON CONFLICT DO UPDATE` serialises on the row in Postgres; 50 parallel calls in the tests produced
  exactly the limit.
- _How do you stop tests from wiping real data?_ Two independent checks of the database name (URL and
  `current_database()`), prefix-scoped Redis clean-up, and a test that proves truncation refuses the
  development URL.
