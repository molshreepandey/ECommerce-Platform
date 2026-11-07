import { z } from 'zod';

export const appEnvironments = ['development', 'test', 'staging', 'production'] as const;
export const appEnvironmentSchema = z.enum(appEnvironments);
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export const rateLimitActions = ['customer-login', 'customer-register', 'staff-login'] as const;
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
    rateLimits: z.strictObject({
      'customer-login': rateLimitPolicySchema,
      'customer-register': rateLimitPolicySchema,
      'staff-login': rateLimitPolicySchema,
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
  })
  .refine(
    (config) =>
      !config.surfaces.store.hosts.some((host) => config.surfaces.admin.hosts.includes(host)),
    { message: 'Store and admin surfaces must not share a host', path: ['surfaces', 'admin'] },
  );

export type AppConfig = z.infer<typeof appConfigSchema>;
export type RateLimitPolicy = AppConfig['rateLimits'][RateLimitAction];
