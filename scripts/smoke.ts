import 'dotenv/config';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';

const SCOPE = {
  userId: 'u_review',
  tenantId: 't_mind_qatar',
  allowedDataStores: ['ServiceRequests', 'Inspections', 'Permits', 'Projects'],
};

interface TestCase {
  name: string;
  endpoint: string;
  body: Record<string, unknown>;
}

const cases: TestCase[] = [
  {
    name: 'Home / inquiry — open municipal requests',
    endpoint: '/api/inquiry',
    body: { prompt: 'find recent service requests where status is new', scope: SCOPE },
  },
  {
    name: 'Report — municipal service trends',
    endpoint: '/api/report',
    body: {
      prompt: 'analyze service request volume by municipality over the last 90 days and surface key trends',
      scope: SCOPE,
      dataStoreName: 'ServiceRequests',
    },
  },
  {
    name: 'Dashboard — service requests by municipality',
    endpoint: '/api/dashboard',
    body: {
      prompt: 'service request count by municipality this month',
      scope: SCOPE,
      dataStoreName: 'ServiceRequests',
    },
  },
  {
    name: 'Dashboard — service request trend',
    endpoint: '/api/dashboard',
    body: {
      prompt: 'daily service request count over the last 30 days',
      scope: SCOPE,
      dataStoreName: 'ServiceRequests',
    },
  },
  {
    name: 'Dashboard — permits by municipality',
    endpoint: '/api/dashboard',
    body: {
      prompt: 'open permits by municipality',
      scope: SCOPE,
      dataStoreName: 'Permits',
    },
  },
];

async function runOne(tc: TestCase): Promise<{ ok: boolean; ms: number; detail?: unknown }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${tc.endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tc.body),
    });
    const ms = Date.now() - t0;
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, ms, detail: data };
  } catch (err: any) {
    return { ok: false, ms: Date.now() - t0, detail: err.message };
  }
}

async function main() {
  console.log(`Running smoke tests against ${BASE}\n`);
  let pass = 0;
  let fail = 0;
  for (const tc of cases) {
    process.stdout.write(`  • ${tc.name.padEnd(50)} `);
    const r = await runOne(tc);
    if (r.ok) {
      console.log(`OK   ${r.ms}ms`);
      pass++;
    } else {
      console.log(`FAIL ${r.ms}ms`);
      console.log('    ', JSON.stringify(r.detail).slice(0, 300));
      fail++;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
