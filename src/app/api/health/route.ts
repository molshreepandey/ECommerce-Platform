import { apiHandler } from '@/lib/api-handler';
import { getConfig } from '@/lib/config';
import { getDatabase } from '@/lib/db';
import { getElasticsearchClient } from '@/lib/elasticsearch';
import { probeWithTimeout, summarizeHealth } from '@/lib/health';
import { runRedisCommand } from '@/lib/redis';

async function pingPostgres(): Promise<boolean> {
  await getDatabase().$queryRaw`SELECT 1`;
  return true;
}

function pingElasticsearch(): Promise<boolean> {
  return getElasticsearchClient().ping();
}

async function pingRedis(): Promise<boolean> {
  return (await runRedisCommand((client) => client.ping())) === 'PONG';
}

export const GET = apiHandler(async () => {
  const { probeTimeoutMilliseconds } = getConfig().health;
  const [postgresStatus, elasticsearchStatus, redisStatus] = await Promise.all([
    probeWithTimeout(pingPostgres, probeTimeoutMilliseconds),
    probeWithTimeout(pingElasticsearch, probeTimeoutMilliseconds),
    probeWithTimeout(pingRedis, probeTimeoutMilliseconds),
  ]);
  const { httpStatus, status, checks } = summarizeHealth({
    postgres: postgresStatus,
    elasticsearch: elasticsearchStatus,
    redis: redisStatus,
  });
  return Response.json(
    { status, checks },
    { status: httpStatus, headers: { 'Cache-Control': 'no-store' } },
  );
});
