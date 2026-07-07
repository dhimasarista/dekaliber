import { randomUUID } from 'node:crypto';
import { LatencyHistogram } from './latency-histogram';
import { insertRun, updateRunFinished, latestCeilingRps } from './storage';

export type Scenario =
  | 'create_brutal'
  | 'read_light'
  | 'read_heavy'
  | 'update_brutal'
  | 'delete_brutal'
  | 'mixed_crud';

export interface RunConfig {
  // Nama bebas untuk ditampilkan di riwayat -- bukan enum tetap, supaya bisa
  // nambah backend baru kapan saja tanpa ubah kode (§ generic target by port).
  target_label: string;
  // null = ceiling check (self dummy endpoint, tidak butuh backend eksternal).
  target_port: number | null;
  scenario: Scenario;
  duration_minutes: number;
  warmup_minutes: number;
  request_interval_ms: number;
  ui_update_interval_ms: number;
  raw_sql_mode: boolean;
}

type Phase = 'warmup' | 'running' | 'done' | 'failed';

interface RunTotals {
  sent: number;
  ok: number;
  failed: number;
}

export interface RunSnapshot {
  id: string;
  phase: Phase;
  elapsedMs: number;
  rps: number;
  latency: ReturnType<LatencyHistogram['snapshot']>;
  totals: RunTotals;
  generatorCeilingRps: number | null;
  referenceCeilingRps: number | null;
  error?: string;
}

type Listener = (event: string, data: unknown) => void;

interface RunState {
  id: string;
  config: RunConfig;
  baseUrl: string;
  phase: Phase;
  startedAt: number;
  measurementStartedAt: number;
  finishedAt?: number;
  histogram: LatencyHistogram;
  totals: RunTotals;
  windowCount: number;
  idPool: string[];
  requestTimer?: ReturnType<typeof setInterval>;
  uiTimer?: ReturnType<typeof setInterval>;
  phaseTimer?: ReturnType<typeof setTimeout>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  listeners: Set<Listener>;
  error?: string;
}

const runs = new Map<string, RunState>();

const ID_POOL_CAP = 1000;
// mixed_crud: bobot create sedikit lebih tinggi supaya pool id terus terisi
// untuk operasi read/update/delete berikutnya.
const MIXED_WEIGHTS: Array<{ op: Op; weight: number }> = [
  { op: 'create', weight: 30 },
  { op: 'read_light', weight: 20 },
  { op: 'read_heavy', weight: 20 },
  { op: 'update', weight: 15 },
  { op: 'delete', weight: 15 },
];

type Op = 'create' | 'read_light' | 'read_heavy' | 'update' | 'delete' | 'dummy';

function pickWeighted(): Op {
  const total = MIXED_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * total;
  for (const entry of MIXED_WEIGHTS) {
    if (roll < entry.weight) return entry.op;
    roll -= entry.weight;
  }
  return 'create';
}

function pickOperation(state: RunState): Op {
  if (state.config.target_port === null) return 'dummy';
  switch (state.config.scenario) {
    case 'create_brutal':
      return 'create';
    case 'read_light':
      return 'read_light';
    case 'read_heavy':
      return 'read_heavy';
    case 'update_brutal':
      return 'update';
    case 'delete_brutal':
      return 'delete';
    case 'mixed_crud':
      return pickWeighted();
  }
}

function pushId(state: RunState, id: string): void {
  state.idPool.push(id);
  if (state.idPool.length > ID_POOL_CAP) state.idPool.shift();
}

function pickRandomId(state: RunState): string | undefined {
  if (state.idPool.length === 0) return undefined;
  return state.idPool[Math.floor(Math.random() * state.idPool.length)];
}

async function createResource(state: RunState): Promise<void> {
  const res = await fetch(`${state.baseUrl}/resource`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: `gen-${Date.now()}`, value: Math.floor(Math.random() * 10_000) }),
  });
  if (!res.ok) throw new Error(`create failed: ${res.status}`);
  const body = (await res.json()) as { id: string };
  pushId(state, body.id);
}

async function performOp(state: RunState, op: Op): Promise<void> {
  switch (op) {
    case 'create':
      return createResource(state);
    case 'dummy': {
      const res = await fetch(`${state.baseUrl}/api/dummy`);
      if (!res.ok) throw new Error(`dummy failed: ${res.status}`);
      return;
    }
    case 'read_light': {
      const id = pickRandomId(state);
      if (!id) return createResource(state);
      const res = await fetch(`${state.baseUrl}/resource/${id}`);
      if (!res.ok) throw new Error(`read_light failed: ${res.status}`);
      return;
    }
    case 'read_heavy': {
      const params = new URLSearchParams({
        page: '1',
        pageSize: '20',
        sort: 'createdAt',
        order: 'desc',
        raw: String(state.config.raw_sql_mode),
      });
      const res = await fetch(`${state.baseUrl}/resource?${params.toString()}`);
      if (!res.ok) throw new Error(`read_heavy failed: ${res.status}`);
      return;
    }
    case 'update': {
      const id = pickRandomId(state);
      if (!id) return createResource(state);
      const res = await fetch(`${state.baseUrl}/resource/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: Math.floor(Math.random() * 10_000) }),
      });
      if (!res.ok) throw new Error(`update failed: ${res.status}`);
      return;
    }
    case 'delete': {
      const index = state.idPool.length > 0 ? Math.floor(Math.random() * state.idPool.length) : -1;
      if (index === -1) return createResource(state);
      const [id] = state.idPool.splice(index, 1);
      const res = await fetch(`${state.baseUrl}/resource/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`delete failed: ${res.status}`);
      return;
    }
  }
}

function recordSample(state: RunState, latencyMs: number, ok: boolean): void {
  state.histogram.record(latencyMs);
  state.totals.sent++;
  state.windowCount++;
  if (ok) state.totals.ok++;
  else state.totals.failed++;
}

function fire(state: RunState): void {
  const op = pickOperation(state);
  const t0 = performance.now();
  performOp(state, op)
    .then(() => recordSample(state, performance.now() - t0, true))
    .catch(() => recordSample(state, performance.now() - t0, false));
}

function publish(state: RunState, event: string, data: unknown): void {
  for (const listener of state.listeners) listener(event, data);
}

function buildSnapshot(state: RunState): RunSnapshot {
  const elapsedMs = Date.now() - (state.phase === 'warmup' ? state.startedAt : state.measurementStartedAt);
  return {
    id: state.id,
    phase: state.phase,
    elapsedMs,
    rps: state.totals.sent === 0 ? 0 : Math.round((state.totals.sent / (elapsedMs / 1000)) * 100) / 100,
    latency: state.histogram.snapshot(),
    totals: { ...state.totals },
    generatorCeilingRps: null,
    referenceCeilingRps: latestCeilingRps(),
    error: state.error,
  };
}

function finishRun(state: RunState, phase: 'done' | 'failed'): void {
  clearInterval(state.requestTimer);
  clearInterval(state.uiTimer);
  clearTimeout(state.phaseTimer);
  state.phase = phase;
  state.finishedAt = Date.now();

  const snapshot = buildSnapshot(state);
  const generatorCeilingRps = state.config.target_port === null ? snapshot.rps : null;
  snapshot.generatorCeilingRps = generatorCeilingRps;

  updateRunFinished({
    id: state.id,
    status: phase,
    finishedAt: state.finishedAt,
    generatorCeilingRps,
    summaryJson: JSON.stringify(snapshot),
  });

  publish(state, 'done', snapshot);

  // Simpan state di memori sebentar untuk late-joining SSE client, lalu buang.
  state.cleanupTimer = setTimeout(() => runs.delete(state.id), 10 * 60_000);
}

export function startRun(config: RunConfig, selfOrigin: string): RunSnapshot {
  const id = randomUUID();
  const baseUrl = config.target_port === null ? selfOrigin : `http://localhost:${config.target_port}`;
  const now = Date.now();
  const warmupMs = Math.max(0, config.warmup_minutes) * 60_000;

  const state: RunState = {
    id,
    config,
    baseUrl,
    phase: warmupMs > 0 ? 'warmup' : 'running',
    startedAt: now,
    measurementStartedAt: now + warmupMs,
    histogram: new LatencyHistogram(),
    totals: { sent: 0, ok: 0, failed: 0 },
    windowCount: 0,
    idPool: [],
    listeners: new Set(),
  };

  runs.set(id, state);
  insertRun({
    id,
    // 'ceiling' tetap dipakai sebagai marker khusus di storage supaya
    // latestCeilingRps() bisa query baris ceiling secara konsisten.
    target: config.target_port === null ? 'ceiling' : config.target_label,
    scenario: config.scenario,
    status: state.phase,
    startedAt: now,
  });

  state.requestTimer = setInterval(() => fire(state), Math.max(1, config.request_interval_ms));

  if (warmupMs > 0) {
    state.phaseTimer = setTimeout(() => {
      state.phase = 'running';
      state.measurementStartedAt = Date.now();
      state.histogram.reset();
      state.totals = { sent: 0, ok: 0, failed: 0 };
      state.windowCount = 0;
      publish(state, 'phase', { phase: 'running' });

      state.phaseTimer = setTimeout(
        () => finishRun(state, 'done'),
        Math.max(1, config.duration_minutes * 60_000),
      );
    }, warmupMs);
  } else {
    state.phaseTimer = setTimeout(
      () => finishRun(state, 'done'),
      Math.max(1, config.duration_minutes * 60_000),
    );
  }

  state.uiTimer = setInterval(() => {
    publish(state, 'update', buildSnapshot(state));
  }, Math.max(100, config.ui_update_interval_ms));

  return buildSnapshot(state);
}

export function getSnapshot(id: string): RunSnapshot | undefined {
  const state = runs.get(id);
  return state ? buildSnapshot(state) : undefined;
}

export function subscribe(id: string, listener: Listener): (() => void) | undefined {
  const state = runs.get(id);
  if (!state) return undefined;
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function isRunFinished(id: string): boolean {
  const state = runs.get(id);
  return !state || state.phase === 'done' || state.phase === 'failed';
}
