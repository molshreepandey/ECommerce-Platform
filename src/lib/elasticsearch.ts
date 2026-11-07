import { Client } from '@elastic/elasticsearch';

import { getEnvironment } from '@/lib/env';

const requestTimeoutMilliseconds = 2_000;

let elasticsearchClient: Client | undefined;

export function getElasticsearchClient(): Client {
  elasticsearchClient ??= new Client({
    node: getEnvironment().ELASTICSEARCH_URL,
    requestTimeout: requestTimeoutMilliseconds,
    maxRetries: 0,
  });
  return elasticsearchClient;
}

export function buildIndexName(baseIndexName: string): string {
  return `${getEnvironment().ELASTICSEARCH_INDEX_PREFIX}_${baseIndexName}`;
}
