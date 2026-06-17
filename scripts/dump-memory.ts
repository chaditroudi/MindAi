/**
 * Usage:  npx tsx scripts/dump-memory.ts [output.txt]
 * Dumps every conversation session + messages to stdout and optionally to a file.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { listSessions, getSessionDetail } from '../src/mastra/memory-store.js';

const outFile = process.argv[2];
const lines: string[] = [];

function line(s = '') { lines.push(s); }

const sessions = await listSessions();

if (!sessions.length) {
  line('No sessions found in memory.db');
} else {
  line(`Memory dump — ${new Date().toISOString()}`);
  line(`Total sessions: ${sessions.length}`);

  for (const s of sessions) {
    line();
    line('═'.repeat(60));
    line(`Session : ${s.sessionId}`);
    line(`Title   : ${s.title}`);
    line(`Intent  : ${s.intent}`);
    line(`Created : ${s.createdAt}`);
    line(`Updated : ${s.updatedAt}`);
    line(`Messages: ${s.messageCount}`);
    line('─'.repeat(60));

    const detail = await getSessionDetail(s.sessionId);
    if (!detail) { line('  (could not load detail)'); continue; }

    for (const msg of detail.messages) {
      const ts = msg.createdAt ?? '';
      if (msg.role === 'user') {
        line(`  [${ts}] USER`);
        line(`    ${msg.prompt ?? '(no prompt)'}`);
      } else {
        const r = msg.result;
        if (!r) continue;
        line(`  [${ts}] ASSISTANT  (${r.type}, ${r.durationMs}ms)`);
        if (r.type === 'inquiry') {
          line(`    ${r.summary ?? ''}`);
        } else if (r.type === 'report') {
          for (const sec of r.reportSections ?? []) {
            line(`    ## ${sec.heading}`);
            line(`    ${sec.body.replace(/\n/g, '\n    ')}`);
          }
        } else if (r.type === 'dashboard') {
          line(`    chart: ${r.dashboardSpec?.title ?? '(untitled)'}`);
          line(`    summary: ${r.dashboardSpec?.summary ?? ''}`);
          line(`    widgets: ${r.dashboardSpec?.widgets?.length ?? 0}`);
        }
      }
    }
  }
}

const output = lines.join('\n');
console.log(output);

if (outFile) {
  writeFileSync(outFile, output, 'utf8');
  console.error(`\nWritten to ${outFile}`);
}
