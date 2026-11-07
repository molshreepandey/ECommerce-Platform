import { Client } from '@elastic/elasticsearch';

import { getConfig } from '@/lib/config';
import { getEnvironment } from '@/lib/env';

let elasticsearchClient: Client | undefined;

export function getElasticsearchClient(): Client {
  const { elasticsearch } = getConfig();
  elasticsearchClient ??= new Client({
    node: getEnvironment().ELASTICSEARCH_URL,
    requestTimeout: elasticsearch.requestTimeoutMilliseconds,
    maxRetries: elasticsearch.maxRetries,
  });
  return elasticsearchClient;
}

export function buildIndexName(baseIndexName: string): string {
  return `${getConfig().elasticsearch.indexPrefix}_${baseIndexName}`;
}
