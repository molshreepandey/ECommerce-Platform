import { z } from 'zod';

const hostListSchema = z
  .string()
  .transform((commaSeparatedHosts) =>
    commaSeparatedHosts
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  )
  .pipe(z.array(z.string()).min(1, 'At least one host is required'));

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    ELASTICSEARCH_URL: z.url({ protocol: /^https?$/ }),
    ELASTICSEARCH_INDEX_PREFIX: z.string().regex(/^[a-z0-9_-]+$/),
    STORE_HOSTS: hostListSchema,
    ADMIN_HOSTS: hostListSchema,
  })
  .refine(
    (environment) =>
      !environment.STORE_HOSTS.some((host) => environment.ADMIN_HOSTS.includes(host)),
    { message: 'STORE_HOSTS and ADMIN_HOSTS must not share a host', path: ['ADMIN_HOSTS'] },
  );

export type Environment = z.infer<typeof environmentSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment variables:\n${issues.join('\n')}`);
    this.name = 'InvalidEnvironmentError';
  }
}

export function parseEnvironment(source: Record<string, string | undefined>): Environment {
  const parseResult = environmentSchema.safeParse(source);
  if (parseResult.success) return parseResult.data;
  const issues = parseResult.error.issues.map(
    (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new InvalidEnvironmentError(issues);
}

let cachedEnvironment: Environment | undefined;

export function getEnvironment(): Environment {
  cachedEnvironment ??= parseEnvironment(process.env);
  return cachedEnvironment;
}
