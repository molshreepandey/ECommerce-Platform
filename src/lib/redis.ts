import { createClient } from 'redis';

import { getConfig } from '@/lib/config';
import { getEnvironment } from '@/lib/env';
import { getLogger } from '@/lib/logger';

export class RedisUnavailableError extends Error {
  constructor(reason: string) {
    super(`Redis is unavailable: ${reason}`);
    this.name = 'RedisUnavailableError';
  }
}

const errorLogIntervalMilliseconds = 30_000;
const firstReconnectDelayMilliseconds = 50;

let redisClient: AppRedisClient | undefined;
let pendingConnection: Promise<unknown> | undefined;
let lastErrorLoggedAt = 0;
let skipRedisUntil = 0;

function logConnectionError(error: unknown): void {
  const now = Date.now();
  if (now - lastErrorLoggedAt < errorLogIntervalMilliseconds) return;
  lastErrorLoggedAt = now;
  getLogger().warn({ err: error }, 'redis connection error');
}

function createAppRedisClient() {
  const { redis } = getConfig();
  const client = createClient({
    url: getEnvironment().REDIS_URL,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: redis.connectTimeoutMilliseconds,
      reconnectStrategy: (retries: number) =>
        Math.min(
          firstReconnectDelayMilliseconds * 2 ** retries,
          redis.maxReconnectDelayMilliseconds,
        ),
    },
  });
  client.on('error', logConnectionError);
  client.on('ready', () => {
    getLogger().info('redis connection ready');
  });
  return client;
}

export type AppRedisClient = ReturnType<typeof createAppRedisClient>;

function isReady(client: AppRedisClient): boolean {
  return client.isReady;
}

function startConnecting(client: AppRedisClient): Promise<unknown> {
  pendingConnection ??= client.connect().finally(() => {
    pendingConnection = undefined;
  });
  return pendingConnection;
}

function waitAtMost(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds).unref());
}

export async function getReadyRedisClient(): Promise<AppRedisClient> {
  redisClient ??= createAppRedisClient();
  const client = redisClient;
  if (isReady(client)) return client;
  if (Date.now() < skipRedisUntil) {
    throw new RedisUnavailableError('recent failure, skipping during cooldown');
  }
  if (!client.isOpen) startConnecting(client).catch(logConnectionError);
  await Promise.race([pendingConnection, waitAtMost(getConfig().redis.connectTimeoutMilliseconds)]);
  if (isReady(client)) return client;
  openCircuit();
  throw new RedisUnavailableError('not connected within the connect timeout');
}

// Circuit breaker: after a failure, callers fall back immediately instead of each waiting for a timeout.
function openCircuit(): void {
  skipRedisUntil = Date.now() + getConfig().redis.failureCooldownMilliseconds;
}

function discardClient(client: AppRedisClient): void {
  if (redisClient === client) redisClient = undefined;
  client.destroy();
}

// node-redis 6.3.1 command timeouts did not abort a reply from a frozen server, so the deadline is enforced here.
export async function runRedisCommand<Result>(
  command: (client: AppRedisClient) => Promise<Result>,
): Promise<Result> {
  const client = await getReadyRedisClient();
  const { replyTimeoutMilliseconds } = getConfig().redis;
  const pendingCommand = command(client);
  pendingCommand.catch(() => undefined);
  let deadline: NodeJS.Timeout | undefined;
  const replyDeadline = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(() => {
      reject(new RedisUnavailableError(`no reply within ${replyTimeoutMilliseconds} ms`));
    }, replyTimeoutMilliseconds);
  });
  try {
    return await Promise.race([pendingCommand, replyDeadline]);
  } catch (error) {
    if (error instanceof RedisUnavailableError) {
      openCircuit();
      discardClient(client);
    }
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

export function buildRedisKey(...keyParts: readonly string[]): string {
  return `${getConfig().redis.keyPrefix}${keyParts.join(':')}`;
}

export async function closeRedisClient(): Promise<void> {
  const client = redisClient;
  redisClient = undefined;
  if (client?.isOpen === true) await client.close();
}
