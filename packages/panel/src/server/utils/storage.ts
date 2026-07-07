import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Cari root monorepo (ditandai nx.json) supaya path storage/results.sqlite
// konsisten dipakai dari manapun `pnpm dev` dijalankan (cwd bisa beda-beda).
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, 'nx.json'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

const repoRoot = findRepoRoot(process.cwd());
const dbPath = resolve(repoRoot, 'storage/results.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');

// storage/results.sqlite bisa jadi peninggalan arsitektur lama (pre-Spec v2)
// yang skemanya beda (kolom `mode` NOT NULL, tanpa generator_ceiling_rps).
// Migrasi non-destruktif: rename tabel lama, buat tabel baru sesuai §9.
const legacyTable = db
  .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'test_runs'`)
  .get() as { sql: string } | undefined;
if (legacyTable && /\bmode\b/.test(legacyTable.sql)) {
  db.exec(`ALTER TABLE test_runs RENAME TO test_runs_legacy_backup;`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS test_runs (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    scenario TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    generator_ceiling_rps REAL,
    summary_json TEXT
  );
`);

export interface TestRunRow {
  id: string;
  target: string;
  scenario: string;
  status: string;
  started_at: number | null;
  finished_at: number | null;
  generator_ceiling_rps: number | null;
  summary_json: string | null;
}

export function insertRun(row: {
  id: string;
  target: string;
  scenario: string;
  status: string;
  startedAt: number;
}): void {
  db.prepare(
    `INSERT INTO test_runs (id, target, scenario, status, started_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(row.id, row.target, row.scenario, row.status, row.startedAt);
}

export function updateRunFinished(row: {
  id: string;
  status: string;
  finishedAt: number;
  generatorCeilingRps: number | null;
  summaryJson: string;
}): void {
  db.prepare(
    `UPDATE test_runs SET status = ?, finished_at = ?, generator_ceiling_rps = ?, summary_json = ? WHERE id = ?`,
  ).run(row.status, row.finishedAt, row.generatorCeilingRps, row.summaryJson, row.id);
}

export function listRecentRuns(limit = 20): TestRunRow[] {
  return db
    .prepare(`SELECT * FROM test_runs ORDER BY started_at DESC LIMIT ?`)
    .all(limit) as unknown as TestRunRow[];
}

export function latestCeilingRps(): number | null {
  const row = db
    .prepare(
      `SELECT generator_ceiling_rps FROM test_runs WHERE target = 'ceiling' AND generator_ceiling_rps IS NOT NULL ORDER BY started_at DESC LIMIT 1`,
    )
    .get() as { generator_ceiling_rps: number } | undefined;
  return row?.generator_ceiling_rps ?? null;
}
