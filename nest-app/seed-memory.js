const { MongoClient } = require('mongodb');

async function run() {
  const client = new MongoClient('mongodb://127.0.0.1:27017');
  await client.connect();
  const db  = client.db('mind_platform');
  const col = db.collection('memory_items');

  await col.deleteMany({ userId: 'demo-user' }); // clean slate

  const now = new Date();
  await col.insertMany([
    {
      userId: 'demo-user', sessionId: 'sess-001',
      type: 'goal',
      content: 'User is building a Qatar municipalities population dashboard',
      tags: ['qatar','municipalities','population','dashboard'],
      importance: 5, embedding: [], createdAt: now, updatedAt: now,
    },
    {
      userId: 'demo-user', sessionId: 'sess-001',
      type: 'insight',
      content: 'Al Rayyan has the highest population among Qatar municipalities at 832,000',
      tags: ['qatar','al-rayyan','population','insight'],
      importance: 4, embedding: [], createdAt: now, updatedAt: now,
    },
    {
      userId: 'demo-user', sessionId: 'sess-002',
      type: 'preference',
      content: 'User prefers bar charts for comparing municipalities',
      tags: ['bar-chart','preference','visualization'],
      importance: 4, embedding: [], createdAt: now, updatedAt: now,
    },
    {
      userId: 'demo-user', sessionId: 'sess-002',
      type: 'decision',
      content: 'Focus analysis on active projects only, exclude completed ones',
      tags: ['projects','filter','active'],
      importance: 3, embedding: [], createdAt: now, updatedAt: now,
    },
    {
      userId: 'demo-user', sessionId: 'sess-003',
      type: 'context',
      content: '22 infrastructure projects currently in progress across Qatar',
      tags: ['projects','infrastructure','qatar','count'],
      importance: 3, embedding: [], createdAt: now, updatedAt: now,
    },
  ]);

  const all = await col.find({ userId: 'demo-user' }).toArray();
  console.log('Stored memories:\n');
  all.forEach((m, i) => {
    console.log(`${i + 1}. [${m.type.toUpperCase()}] (importance: ${m.importance})`);
    console.log(`   ${m.content}`);
    console.log(`   tags: ${m.tags.join(', ')}\n`);
  });
  await client.close();
}

run().catch(console.error);
