import { z } from 'zod';

import { appEnvironmentSchema } from '@/lib/config/config.schema';

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: appEnvironmentSchema,
  APP_CONFIG_PATH: z.string().min(1).optional(),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  ELASTICSEARCH_URL: z.url({ protocol: /^https?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // HMAC secret for demo courier webhooks; required outside development and test (see courier-secret.ts).
  COURIER_WEBHOOK_SECRET: z.string().min(32).optional(),
  // Plan C3: show the login OTP in the UI (demo only). Unset = true outside production.
  OTP_DISPLAY_IN_UI: z.enum(['true', 'false']).optional(),
});

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
