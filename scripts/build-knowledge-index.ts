import 'dotenv/config';
import { closeMongo } from '../src/db/mongo.client.js';
import { indexKnowledgeInMongo, semanticSearchExportKnowledge } from '../src/knowledge/export-knowledge.js';

async function main() {
  const warmed = await indexKnowledgeInMongo();
  console.log(
    `Knowledge index ready: ${warmed.chunkCount} chunks in ${warmed.collectionName} for tenant ${warmed.tenantId} using ${warmed.embeddingModel}`,
  );

  const sampleQuery = process.argv.slice(2).join(' ').trim();
  if (!sampleQuery) return;

  const hits = await semanticSearchExportKnowledge(sampleQuery, 5, warmed.tenantId);
  console.log(`Top semantic hits for "${sampleQuery}":`);
  for (const hit of hits) {
    console.log(`- ${hit.title} [${hit.collection}] score=${hit.score.toFixed(4)}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo().catch(() => undefined);
  });
