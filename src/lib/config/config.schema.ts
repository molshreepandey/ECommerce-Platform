import { z } from 'zod';

export const appEnvironments = ['development', 'test', 'staging', 'production'] as const;
export const appEnvironmentSchema = z.enum(appEnvironments);
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export const rateLimitActions = [
  'customer-login',
  'customer-register',
  'staff-login',
  'inventory-write',
  'checkout',
  'payment-attempt',
  'cart-write',
  'otp-request',
  'otp-verify',
  'staff-write',
  'public-search',
  'review-write',
] as const;
export const rateLimitActionSchema = z.enum(rateLimitActions);
export type RateLimitAction = z.infer<typeof rateLimitActionSchema>;

const positiveMilliseconds = z.int().min(1).max(600_000);
const hostWithOptionalPort = z
  .string()
  .regex(/^[a-z0-9.-]+(:\d{1,5})?$/, 'Expected a lowercase host name with an optional port');
const contentSecuritySource = z
  .string()
  .regex(
    /^(https:\/\/[a-z0-9.*-]+(:\d{1,5})?|data:|blob:)$/,
    'Expected https://host, data: or blob:',
  );

const surfaceSchema = z.strictObject({
  hosts: z.array(hostWithOptionalPort).min(1),
  publicOrigin: z.url({ protocol: /^https?$/ }),
});

const rateLimitPolicySchema = z.strictObject({
  maxRequests: z.int().min(1).max(10_000),
  windowSeconds: z.int().min(1).max(86_400),
});

export const appConfigSchema = z
  .strictObject({
    surfaces: z.strictObject({ store: surfaceSchema, admin: surfaceSchema }),
    logging: z.strictObject({
      level: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),
    }),
    database: z.strictObject({
      poolMaxConnections: z.int().min(1).max(100),
      connectionTimeoutMilliseconds: positiveMilliseconds,
      idleTimeoutMilliseconds: positiveMilliseconds,
    }),
    elasticsearch: z.strictObject({
      indexPrefix: z.string().regex(/^[a-z0-9_-]+$/),
      requestTimeoutMilliseconds: positiveMilliseconds,
      maxRetries: z.int().min(0).max(5),
    }),
    redis: z.strictObject({
      keyPrefix: z.string().regex(/^[a-z0-9_-]+(:[a-z0-9_-]+)*:$/, 'Must end with ":"'),
      connectTimeoutMilliseconds: positiveMilliseconds,
      replyTimeoutMilliseconds: positiveMilliseconds,
      maxReconnectDelayMilliseconds: positiveMilliseconds,
      failureCooldownMilliseconds: positiveMilliseconds,
    }),
    health: z.strictObject({ probeTimeoutMilliseconds: positiveMilliseconds }),
    authentication: z.strictObject({
      customerSessionTtlDays: z.int().min(1).max(90),
      staffSessionTtlHours: z.int().min(1).max(72),
      secureCookies: z.boolean(),
      trustedProxyHopCount: z.int().min(0).max(5),
      demoAccountsAllowed: z.boolean(),
      passwordHashing: z.strictObject({
        memoryCostKib: z.int().min(19_456),
        timeCost: z.int().min(2),
        parallelism: z.int().min(1).max(8),
      }),
    }),
    rateLimits: z.strictObject({
      'customer-login': rateLimitPolicySchema,
      'customer-register': rateLimitPolicySchema,
      'staff-login': rateLimitPolicySchema,
      'inventory-write': rateLimitPolicySchema,
      checkout: rateLimitPolicySchema,
      'payment-attempt': rateLimitPolicySchema,
      'cart-write': rateLimitPolicySchema,
      'otp-request': rateLimitPolicySchema,
      'otp-verify': rateLimitPolicySchema,
      'staff-write': rateLimitPolicySchema,
      'public-search': rateLimitPolicySchema,
      'review-write': rateLimitPolicySchema,
    }),
    security: z.strictObject({
      strictTransportSecurityMaxAgeSeconds: z.int().min(0),
      contentSecurityPolicy: z.strictObject({
        imageSources: z.array(contentSecuritySource),
        connectSources: z.array(contentSecuritySource),
        scriptSources: z.array(contentSecuritySource),
        frameSources: z.array(contentSecuritySource),
      }),
    }),
    // Optional feature flags for development configuration
    featureFlags: z
      .strictObject({
        enableDistanceAllocation: z.boolean().optional(),
      })
      .optional(),
  })
  .refine(
    (config) =>
      !config.surfaces.store.hosts.some((host) => config.surfaces.admin.hosts.includes(host)),
    { message: 'Store and admin surfaces must not share a host', path: ['surfaces', 'admin'] },
  );

export type AppConfig = z.infer<typeof appConfigSchema>;
export type RateLimitPolicy = AppConfig['rateLimits'][RateLimitAction];
