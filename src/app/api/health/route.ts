import { apiHandler } from '@/lib/api-handler';
import { getDatabase } from '@/lib/db';
import { getElasticsearchClient } from '@/lib/elasticsearch';
import { probeWithTimeout, summarizeHealth } from '@/lib/health';

const dependencyProbeTimeoutMilliseconds = 2_000;

async function pingPostgres(): Promise<boolean> {
  await getDatabase().$queryRaw`SELECT 1`;
  return true;
}

function pingElasticsearch(): Promise<boolean> {
  return getElasticsearchClient().ping();
}

export const GET = apiHandler(async () => {
  const [postgresStatus, elasticsearchStatus] = await Promise.all([
    probeWithTimeout(pingPostgres, dependencyProbeTimeoutMilliseconds),
    probeWithTimeout(pingElasticsearch, dependencyProbeTimeoutMilliseconds),
  ]);
  const { httpStatus, status, checks } = summarizeHealth({
    postgres: postgresStatus,
    elasticsearch: elasticsearchStatus,
  });
  return Response.json(
    { status, checks },
    { status: httpStatus, headers: { 'Cache-Control': 'no-store' } },
  );
});
