// mixed_crud load test — k6 port of the weighted operation mix used by the
// panel's built-in generator (packages/panel/src/server/utils/run-manager.ts
// MIXED_WEIGHTS). Same op distribution, so results are comparable to runs
// triggered from the panel UI, but driven by k6's Go-based VUs instead of a
// single Node event loop — useful as a higher-throughput cross-check when
// you suspect the panel's own generator is the bottleneck, not the backend.
//
// Usage:
//   BASE_URL=http://localhost:8080 k6 run _infra/k6/mixed-crud.js
//   BASE_URL=http://localhost:8081 RAW_SQL=true VUS=20 DURATION=2m k6 run _infra/k6/mixed-crud.js
//
// Env vars:
//   BASE_URL   target backend, e.g. http://localhost:8080 (Spring Boot JVM),
//              :8081 (Spring Boot native), :8082 (Fiber), :3000 (NestJS)
//   VUS        virtual users (default 10)
//   DURATION   test duration, k6 time string (default "1m")
//   WARMUP     ramp-up duration before the measured window (default "10s")
//   RAW_SQL    "true" to hit GET /resource?raw=true (bypass ORM query
//              builder) on read_heavy ops, matching the panel's
//              raw_sql_mode toggle (default "false")
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const VUS = Number(__ENV.VUS || 500);
const DURATION = __ENV.DURATION || '1m';
const WARMUP = __ENV.WARMUP || '10s';
const RAW_SQL = (__ENV.RAW_SQL || 'false') === 'true';

// Mirrors run-manager.ts MIXED_WEIGHTS exactly — keep these in sync if that
// file's weights change, so panel runs and k6 runs stay comparable.
const WEIGHTS = [
  { op: 'create', weight: 30 },
  { op: 'read_light', weight: 20 },
  { op: 'read_heavy', weight: 20 },
  { op: 'update', weight: 15 },
  { op: 'delete', weight: 15 },
];
const TOTAL_WEIGHT = WEIGHTS.reduce((sum, w) => sum + w.weight, 0);

const opDuration = new Trend('op_duration', true);
const opFailures = new Counter('op_failures');

// Shared across VUs within one k6 instance (k6 runs VUs as goroutines in a
// single process, not separate OS processes, so a module-level array is a
// valid shared pool here — unlike run-manager.ts's per-run idPool, this
// pool is shared by all VUs for the whole test).
const idPool = [];
const ID_POOL_CAP = 1000;

function pushId(id) {
  idPool.push(id);
  if (idPool.length > ID_POOL_CAP) idPool.shift();
}

function pickRandomId() {
  if (idPool.length === 0) return undefined;
  return idPool[Math.floor(Math.random() * idPool.length)];
}
  
function pickWeighted() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const entry of WEIGHTS) {
    if (roll < entry.weight) return entry.op;
    roll -= entry.weight;
  }
  return 'create';
}

function createResource() {
  const res = http.post(
    `${BASE_URL}/resource`,
    JSON.stringify({ label: `k6-${Date.now()}`, value: Math.floor(Math.random() * 10_000) }),
    { headers: { 'Content-Type': 'application/json' }, tags: { op: 'create' } },
  );
  const ok = check(res, { 'create: status 2xx': (r) => r.status >= 200 && r.status < 300 });
  if (ok) {
    const body = res.json();
    if (body && body.id) pushId(body.id);
  } else {
    opFailures.add(1, { op: 'create' });
  }
  return res;
}

function readLight() {
  const id = pickRandomId();
  if (!id) return createResource();
  // `name` groups every /resource/:id request under one metric series
  // instead of one per unique id — without it, k6 tags each URL verbatim
  // and a run with thousands of distinct ids blows past k6's 100k
  // time-series soft limit (high memory use, WARN in the run output).
  const res = http.get(`${BASE_URL}/resource/${id}`, {
    tags: { op: 'read_light', name: `${BASE_URL}/resource/:id` },
  });
  if (!check(res, { 'read_light: status 200': (r) => r.status === 200 })) {
    opFailures.add(1, { op: 'read_light' });
  }
  return res;
}

function readHeavy() {
  // k6's Goja JS runtime has no built-in URLSearchParams, unlike Node/browsers.
  const query = 'page=1&pageSize=20&sort=createdAt&order=desc&raw=' + String(RAW_SQL);
  const res = http.get(`${BASE_URL}/resource?${query}`, { tags: { op: 'read_heavy' } });
  if (!check(res, { 'read_heavy: status 200': (r) => r.status === 200 })) {
    opFailures.add(1, { op: 'read_heavy' });
  }
  return res;
}

function updateResource() {
  const id = pickRandomId();
  if (!id) return createResource();
  const res = http.put(
    `${BASE_URL}/resource/${id}`,
    JSON.stringify({ value: Math.floor(Math.random() * 10_000) }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { op: 'update', name: `${BASE_URL}/resource/:id` },
    },
  );
  if (!check(res, { 'update: status 200': (r) => r.status === 200 })) {
    opFailures.add(1, { op: 'update' });
  }
  return res;
}

function deleteResource() {
  const index = idPool.length > 0 ? Math.floor(Math.random() * idPool.length) : -1;
  if (index === -1) return createResource();
  const [id] = idPool.splice(index, 1);
  const res = http.del(`${BASE_URL}/resource/${id}`, null, {
    tags: { op: 'delete', name: `${BASE_URL}/resource/:id` },
  });
  // 404 is tolerated here for the same reason as run-manager.ts: another VU
  // may have already deleted this id from the shared pool.
  if (!check(res, { 'delete: status 204 or 404': (r) => r.status === 204 || r.status === 404 })) {
    opFailures.add(1, { op: 'delete' });
  }
  return res;
}

const OPS = {
  create: createResource,
  read_light: readLight,
  read_heavy: readHeavy,
  update: updateResource,
  delete: deleteResource,
};

export const options = {
  scenarios: {
    mixed_crud: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: WARMUP, target: VUS },
        { duration: DURATION, target: VUS },
      ],
      gracefulRampDown: '5s',
    },
  },
};

export default function () {
  const op = pickWeighted();
  const t0 = Date.now();
  OPS[op]();
  opDuration.add(Date.now() - t0, { op });
}
