// Remote cache handler for 'use cache: remote' (next.config.ts → cacheHandlers.remote), per
// docs/redis-design.md §5.1. Next.js loads this file directly at run time (it is not bundled), so it is
// plain JavaScript with no project imports. Redis holds disposable copies only: every failure is a cache
// miss or a skipped write, never an error for the page.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createClient } from 'redis';

const defaultExpireSeconds = 86_400;
const jitterRatio = 0.1;

const disabledSettings = {
  url: '',
  keyPrefix: 'disabled:',
  connectTimeoutMilliseconds: 500,
  replyTimeoutMilliseconds: 500,
  failureCooldownMilliseconds: 5000,
  maxReconnectDelayMilliseconds: 2000,
};

// Without a readable config (for example a build machine with no APP_ENV config) the handler stays
// disabled: every read is a miss, so pages render from PostgreSQL.
function loadRedisSettings() {
  const environment = process.env.APP_ENV ?? 'development';
  const configPath = path.join(process.cwd(), 'config', `config.${environment}.json`);
  let redis;
  try {
    ({ redis } = JSON.parse(readFileSync(configPath, 'utf8')));
  } catch {
    return disabledSettings;
  }
  return {
    url: process.env.REDIS_URL ?? '',
    keyPrefix: redis.keyPrefix,
    connectTimeoutMilliseconds: redis.connectTimeoutMilliseconds,
    replyTimeoutMilliseconds: redis.replyTimeoutMilliseconds,
    failureCooldownMilliseconds: redis.failureCooldownMilliseconds,
    maxReconnectDelayMilliseconds: redis.maxReconnectDelayMilliseconds,
  };
}

export function createRedisCacheHandler(settings = loadRedisSettings()) {
  const tagHashKey = `${settings.keyPrefix}cache:v1:tags`;
  const entryKey = (cacheKey) =>
    `${settings.keyPrefix}cache:v1:entry:${createHash('sha256').update(cacheKey).digest('hex')}`;
  const localTagTimestamps = new Map();
  let client;
  let skipUntil = 0;

  function connectedClient() {
    if (settings.url === '' || Date.now() < skipUntil) return null;
    if (client === undefined) {
      client = createClient({
        url: settings.url,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: settings.connectTimeoutMilliseconds,
          reconnectStrategy: (retries) =>
            Math.min(50 * 2 ** retries, settings.maxReconnectDelayMilliseconds),
        },
      });
      client.on('error', () => {});
      client.connect().catch(() => {});
    }
    return client;
  }

  // Every call has a deadline; a failure opens a short cooldown so later requests skip Redis at once.
  async function run(command) {
    const redis = connectedClient();
    if (redis === null) throw new Error('redis skipped');
    let deadline;
    try {
      return await Promise.race([
        (async () => {
          if (!redis.isReady) {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error('redis not ready')),
                settings.connectTimeoutMilliseconds,
              );
              redis.once('ready', () => {
                clearTimeout(timer);
                resolve();
              });
            });
          }
          return await command(redis);
        })(),
        new Promise((_resolve, reject) => {
          deadline = setTimeout(
            () => reject(new Error('redis reply timeout')),
            settings.replyTimeoutMilliseconds + settings.connectTimeoutMilliseconds,
          );
        }),
      ]);
    } catch (error) {
      skipUntil = Date.now() + settings.failureCooldownMilliseconds;
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  }

  function tagState(tag) {
    return localTagTimestamps.get(tag) ?? { stale: 0, expired: 0 };
  }

  function rememberTags(fields) {
    for (const [tag, value] of Object.entries(fields)) {
      try {
        const parsed = JSON.parse(value);
        localTagTimestamps.set(tag, {
          stale: Number(parsed.stale) || 0,
          expired: Number(parsed.expired) || 0,
        });
      } catch {
        // A malformed value is ignored; the entry's own expiry still applies.
      }
    }
  }

  return {
    async get(cacheKey) {
      try {
        const stored = await run((redis) => redis.get(entryKey(cacheKey)));
        if (stored === null) return undefined;
        const entry = JSON.parse(stored);
        let revalidate = entry.revalidate;
        for (const tag of entry.tags) {
          const { stale, expired } = tagState(tag);
          if (expired > entry.timestamp && expired <= Date.now()) return undefined;
          if (stale > entry.timestamp) revalidate = -1;
        }
        const bytes = Buffer.from(entry.value, 'base64');
        return {
          value: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(bytes));
              controller.close();
            },
          }),
          tags: entry.tags,
          stale: entry.stale,
          timestamp: entry.timestamp,
          expire: entry.expire,
          revalidate,
        };
      } catch {
        return undefined;
      }
    },

    async set(cacheKey, pendingEntry) {
      try {
        const entry = await pendingEntry;
        const bytes = Buffer.from(await new Response(entry.value).arrayBuffer());
        const expireSeconds = Number.isFinite(entry.expire) ? entry.expire : defaultExpireSeconds;
        const jitter = 1 + (Math.random() * 2 - 1) * jitterRatio;
        const ttlMilliseconds = Math.max(1000, Math.round(expireSeconds * 1000 * jitter));
        await run((redis) =>
          redis.set(
            entryKey(cacheKey),
            JSON.stringify({
              value: bytes.toString('base64'),
              tags: entry.tags,
              stale: entry.stale,
              timestamp: entry.timestamp,
              expire: entry.expire,
              revalidate: entry.revalidate,
            }),
            { PX: ttlMilliseconds },
          ),
        );
      } catch {
        // The page was already served; the next request renders again.
      }
    },

    async refreshTags() {
      try {
        rememberTags(await run((redis) => redis.hGetAll(tagHashKey)));
      } catch {
        // Keep the tag state this instance already knows.
      }
    },

    async getExpiration(tags) {
      return Math.max(0, ...tags.map((tag) => tagState(tag).expired));
    },

    async updateTags(tags, durations) {
      const now = Date.now();
      const fields = {};
      for (const tag of tags) {
        const previous = tagState(tag);
        const next = durations
          ? {
              stale: now,
              expired:
                durations.expire === undefined ? previous.expired : now + durations.expire * 1000,
            }
          : { stale: now, expired: now };
        localTagTimestamps.set(tag, next);
        fields[tag] = JSON.stringify(next);
      }
      if (tags.length === 0) return;
      try {
        await run((redis) => redis.hSet(tagHashKey, fields));
      } catch {
        // Other instances learn of it only when entries expire; this instance already has it locally.
      }
    },

    async close() {
      if (client?.isOpen) await client.close();
    },
  };
}

export default createRedisCacheHandler();
