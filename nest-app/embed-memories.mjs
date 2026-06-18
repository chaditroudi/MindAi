// ESM script — generates embeddings for all memories that don't have one yet
// Run with: node embed-memories.mjs

import { pipeline, env } from '@xenova/transformers';
import { MongoClient } from 'mongodb';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
env.cacheDir = resolve(__dirname, '.model-cache');

function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

async function embed(pipe, text) {
  const out = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

async function run() {
  console.log('Loading embedding model...');
  const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('Model ready.\n');

  const client = new MongoClient('mongodb://127.0.0.1:27017');
  await client.connect();
  const col = client.db('mind_platform').collection('memory_items');

  // Generate embeddings for all demo-user memories
  const items = await col.find({ userId: 'demo-user' }).toArray();
  console.log(`Generating embeddings for ${items.length} memories...\n`);

  for (const item of items) {
    const vec = await embed(pipe, item.content);
    await col.updateOne({ _id: item._id }, { $set: { embedding: vec } });
    console.log(`✓ [${item.type.toUpperCase()}] embedded (${vec.length} dims)`);
    console.log(`  "${item.content.slice(0, 70)}..."\n`);
  }

  // ─── Demonstrate semantic retrieval ───
  const TEST_QUERIES = [
    'Which city has the most people?',
    'How many ongoing construction projects?',
    'What chart type should I use?',
    'Tell me about Qatar urban areas',
  ];

  console.log('\n══════════════════════════════════════════');
  console.log('  SEMANTIC RETRIEVAL DEMO');
  console.log('══════════════════════════════════════════\n');

  const allDocs = await col.find({ userId: 'demo-user' }).toArray();

  for (const query of TEST_QUERIES) {
    const qVec = await embed(pipe, query);
    const scored = allDocs.map(doc => ({
      doc,
      score: cosineSim(qVec, doc.embedding),
    })).sort((a, b) => b.score - a.score);

    console.log(`Query: "${query}"`);
    scored.slice(0, 3).forEach((s, i) => {
      const bar = '█'.repeat(Math.round(s.score * 20));
      console.log(`  ${i+1}. ${bar} ${(s.score * 100).toFixed(1)}%  [${s.doc.type}] ${s.doc.content.slice(0,60)}...`);
    });
    console.log();
  }

  await client.close();
}

run().catch(console.error);
