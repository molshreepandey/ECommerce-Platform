import pino, { type Logger } from 'pino';

import { getConfig } from '@/lib/config';

const redactedPaths = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'otpCode',
  '*.otpCode',
  'headers.cookie',
  'headers.authorization',
  '*.addressLine1',
  '*.addressLine2',
];

let rootLogger: Logger | undefined;

export function getLogger(): Logger {
  rootLogger ??= pino({
    level: getConfig().logging.level,
    base: { service: 'ecommerce-platform' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: redactedPaths, censor: '[redacted]' },
  });
  return rootLogger;
}

export function createRequestLogger(requestId: string): Logger {
  return getLogger().child({ requestId });
}
