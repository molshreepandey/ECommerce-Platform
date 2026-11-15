// `npm run search:reindex`: zero-downtime full rebuild (new versioned index, alias swap, old one dropped).
import 'dotenv/config';

import { reindexAllProducts } from '@/modules/search/product-search-index.service';

const { indexName, productCount } = await reindexAllProducts();
console.log(`Reindexed ${String(productCount)} products into ${indexName}.`);
process.exit(0);
