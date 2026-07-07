import { Component, OnDestroy, OnInit, signal } from '@angular/core';

type Scenario =
  | 'create_brutal'
  | 'read_light'
  | 'read_heavy'
  | 'update_brutal'
  | 'delete_brutal'
  | 'mixed_crud';

interface SavedTarget {
  id: string;
  label: string;
  port: number;
}

interface BenchmarkForm {
  target_label: string;
  target_port: number | null; // null = ceiling check (self dummy endpoint)
  scenario: Scenario;
  duration_minutes: number;
  warmup_minutes: number;
  request_interval_ms: number;
  ui_update_interval_ms: number;
  postgresql_enabled: boolean;
  redis_enabled: boolean;
  raw_sql_mode: boolean;
}

type RunStatus = 'running' | 'done' | 'failed';

interface RunRecord {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  target: string;
  scenario: Scenario;
  status: RunStatus;
  notes: string;
  summary: RunSnapshot | null;
}

interface LatencySnapshot {
  count: number;
  meanMs: number;
  p50: number;
  p95: number;
  p99: number;
  maxMs: number;
}

interface RunSnapshot {
  id: string;
  phase: 'warmup' | 'running' | 'done' | 'failed';
  elapsedMs: number;
  rps: number;
  latency: LatencySnapshot;
  totals: { sent: number; ok: number; failed: number };
  generatorCeilingRps: number | null;
  referenceCeilingRps: number | null;
  memory: Record<string, number> | null;
  error?: string;
}

interface MetricCard {
  label: string;
  value: string;
  hint: string;
  color: string;
}

type PortStatus = 'idle' | 'checking' | 'up' | 'down';

const scenarios: Array<{ value: Scenario; label: string; description: string; color: string }> = [
  { value: 'create_brutal', label: 'Create brutal', description: 'Insert throughput', color: 'rust' },
  { value: 'read_light', label: 'Read light', description: 'GET by id', color: 'teal' },
  { value: 'read_heavy', label: 'Read heavy', description: 'Filtered + sorted query', color: 'brass' },
  { value: 'update_brutal', label: 'Update brutal', description: 'Lock contention', color: 'mustard' },
  { value: 'delete_brutal', label: 'Delete brutal', description: 'Cascade + cleanup', color: 'plum' },
  { value: 'mixed_crud', label: 'Mixed CRUD', description: 'Weighted mix', color: 'moss' },
];

const METRIC_COLORS = ['rust', 'mustard', 'brass', 'moss', 'clay', 'teal', 'plum'];

const DEFAULT_TARGETS: SavedTarget[] = [
  { id: 'nestjs', label: 'NestJS', port: 3000 },
  { id: 'springboot-kotlin', label: 'Spring Boot (Kotlin)', port: 8080 },
];

const TARGETS_STORAGE_KEY = 'dekaliber.saved-targets';

// Lookup literal supaya nama class lengkap ("border-rust" dst) tetap ada di
// source untuk di-scan Tailwind JIT -- membangun string lewat konkatenasi
// runtime ("border-" + color) tidak akan terdeteksi scanner.
const COLOR_BORDER: Record<string, string> = {
  rust: 'border-rust',
  moss: 'border-moss',
  mustard: 'border-mustard',
  brass: 'border-brass',
  teal: 'border-teal',
  plum: 'border-plum',
  clay: 'border-clay',
};
const COLOR_TEXT: Record<string, string> = {
  rust: 'text-rust',
  moss: 'text-moss',
  mustard: 'text-mustard',
  brass: 'text-brass',
  teal: 'text-teal',
  plum: 'text-plum',
  clay: 'text-clay',
};
const COLOR_DOT: Record<string, string> = {
  rust: 'bg-rust',
  moss: 'bg-moss',
  mustard: 'bg-mustard',
  brass: 'bg-brass',
  clay: 'bg-clay',
  teal: 'bg-teal',
  plum: 'bg-plum',
};

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './index.page.html',
})
export default class Home implements OnInit, OnDestroy {
  protected readonly scenarios = scenarios;

  protected readonly status = signal<'idle' | 'ready'>('idle');

  protected readonly savedTargets = signal<SavedTarget[]>(this.loadSavedTargets());

  protected readonly portStatus = signal<PortStatus>('idle');

  protected readonly form = signal<BenchmarkForm>({
    target_label: 'NestJS',
    target_port: 3000,
    scenario: 'read_light',
    duration_minutes: 5,
    warmup_minutes: 2,
    request_interval_ms: 100,
    ui_update_interval_ms: 750,
    postgresql_enabled: true,
    redis_enabled: false,
    raw_sql_mode: false,
  });

  protected readonly history = signal<RunRecord[]>([]);

  // Simpan id saja (bukan snapshot RunRecord) supaya detail panel ikut
  // ter-update live selama run masih berjalan, bukan cuma foto diam.
  protected readonly selectedRunId = signal<string | null>(null);

  protected readonly logLines = signal<string[]>(['Configure a run and press Run.']);

  protected readonly metricCards = signal<MetricCard[]>([
    { label: 'Effective RPS', value: '—', hint: '', color: METRIC_COLORS[0] },
    { label: 'p95 latency', value: '—', hint: '', color: METRIC_COLORS[1] },
    { label: 'p99 latency', value: '—', hint: '', color: METRIC_COLORS[2] },
    { label: 'Requests', value: '—', hint: 'ok / failed', color: METRIC_COLORS[3] },
    { label: 'Memory', value: '—', hint: 'not reported yet', color: METRIC_COLORS[4] },
    { label: 'Generator ceiling', value: 'Not measured', hint: 'validate before comparing backends', color: METRIC_COLORS[5] },
    { label: 'Status', value: 'Idle', hint: '', color: METRIC_COLORS[6] },
  ]);

  private eventSource: EventSource | undefined;
  private portCheckTimer: ReturnType<typeof setTimeout> | undefined;
  private portPollTimer: ReturnType<typeof setInterval> | undefined;

  ngOnInit(): void {
    void this.loadHistory();
    void this.checkCurrentPort();
    this.portPollTimer = setInterval(() => void this.checkCurrentPort(), 5000);
  }

  ngOnDestroy(): void {
    this.eventSource?.close();
    clearTimeout(this.portCheckTimer);
    clearInterval(this.portPollTimer);
  }

  private loadSavedTargets(): SavedTarget[] {
    try {
      const raw = localStorage.getItem(TARGETS_STORAGE_KEY);
      if (!raw) return DEFAULT_TARGETS;
      const parsed = JSON.parse(raw) as SavedTarget[];
      return parsed.length > 0 ? parsed : DEFAULT_TARGETS;
    } catch {
      return DEFAULT_TARGETS;
    }
  }

  private persistSavedTargets(targets: SavedTarget[]): void {
    try {
      localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(targets));
    } catch {
      // storage unavailable (e.g. SSR/private mode); saved targets just won't persist
    }
  }

  protected selectSavedTarget(target: SavedTarget): void {
    this.updateForm('target_label', target.label);
    this.updateForm('target_port', target.port);
    void this.checkCurrentPort();
  }

  protected removeSavedTarget(id: string): void {
    const next = this.savedTargets().filter((t) => t.id !== id);
    this.savedTargets.set(next);
    this.persistSavedTargets(next);
  }

  protected saveCurrentAsTarget(): void {
    const form = this.form();
    if (form.target_port === null) return;
    const label = form.target_label || `Port ${form.target_port}`;
    const existing = this.savedTargets().find((t) => t.port === form.target_port);

    // Port yang sama sudah tersimpan -- update labelnya saja, jangan numpuk duplikat.
    const next = existing
      ? this.savedTargets().map((t) => (t.port === form.target_port ? { ...t, label } : t))
      : [...this.savedTargets(), { id: `${Date.now()}`, label, port: form.target_port }];

    this.savedTargets.set(next);
    this.persistSavedTargets(next);
  }

  protected updateLabel(event: Event): void {
    this.updateForm('target_label', (event.target as HTMLInputElement).value);
  }

  protected updatePort(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.updateForm('target_port', raw === '' ? null : Number(raw));
    clearTimeout(this.portCheckTimer);
    this.portCheckTimer = setTimeout(() => void this.checkCurrentPort(), 400);
  }

  protected toggleCeiling(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      this.updateForm('target_port', null);
      this.updateForm('target_label', 'Ceiling check');
      this.portStatus.set('up');
    } else {
      this.updateForm('target_port', 3000);
      this.updateForm('target_label', 'NestJS');
      void this.checkCurrentPort();
    }
  }

  private async checkCurrentPort(): Promise<void> {
    const port = this.form().target_port;
    if (port === null) {
      this.portStatus.set('up');
      return;
    }
    this.portStatus.set('checking');
    try {
      const res = await fetch(`/api/health?ports=${port}`);
      if (!res.ok) {
        this.portStatus.set('down');
        return;
      }
      const body = (await res.json()) as Record<string, boolean>;
      this.portStatus.set(body[String(port)] ? 'up' : 'down');
    } catch {
      this.portStatus.set('down');
    }
  }

  protected portStatusLabel(): string {
    const status = this.portStatus();
    if (status === 'checking') return 'Checking…';
    if (status === 'up') return 'Reachable';
    if (status === 'down') return 'Unreachable';
    return 'Unknown';
  }

  protected portStatusColor(): string {
    const status = this.portStatus();
    if (status === 'up') return 'text-moss';
    if (status === 'down') return 'text-rust';
    return 'text-ink-faint';
  }

  protected canRun(): boolean {
    return this.form().target_port === null || this.portStatus() === 'up';
  }

  private async loadHistory(): Promise<void> {
    try {
      const res = await fetch('/api/history');
      if (!res.ok) return;
      const rows = (await res.json()) as Array<{
        id: string;
        target: string;
        scenario: Scenario;
        status: RunStatus;
        startedAt: number;
        finishedAt: number | null;
        summary: RunSnapshot | null;
      }>;
      this.history.set(
        rows.map((row) => ({
          id: row.id,
          startedAt: new Date(row.startedAt).toLocaleString('en-US'),
          finishedAt: row.finishedAt ? new Date(row.finishedAt).toLocaleString('en-US') : null,
          target: row.target,
          scenario: row.scenario,
          status: row.status,
          notes: this.notesFor(row.status, row.summary),
          summary: row.summary,
        })),
      );
    } catch {
      // history is best-effort; ignore if storage isn't ready yet
    }
  }

  private notesFor(status: RunStatus, snapshot: RunSnapshot | null): string {
    if (status === 'failed') return snapshot?.error ?? 'Run failed, check server logs.';
    if (status === 'running') return 'Running…';
    if (!snapshot) return 'Done.';
    return `RPS ${snapshot.rps} · p95 ${snapshot.latency.p95}ms · p99 ${snapshot.latency.p99}ms · ${snapshot.totals.ok}/${snapshot.totals.sent} ok`;
  }

  protected selectRun(run: RunRecord): void {
    this.selectedRunId.set(run.id);
  }

  protected closeRunDetail(): void {
    this.selectedRunId.set(null);
  }

  protected selectedRunRecord(): RunRecord | undefined {
    const id = this.selectedRunId();
    return id ? this.history().find((r) => r.id === id) : undefined;
  }

  protected statusColor(status: RunStatus): string {
    if (status === 'done') return 'text-moss';
    if (status === 'failed') return 'text-rust';
    return 'text-mustard';
  }

  protected updateScenario(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as Scenario;
    this.updateForm('scenario', value);
  }

  protected updateNumberField(
    field: keyof Pick<BenchmarkForm, 'duration_minutes' | 'warmup_minutes' | 'request_interval_ms' | 'ui_update_interval_ms'>,
    event: Event,
  ): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.updateForm(field, value);
  }

  protected updateCheckboxField(
    field: keyof Pick<BenchmarkForm, 'postgresql_enabled' | 'redis_enabled' | 'raw_sql_mode'>,
    event: Event,
  ): void {
    const value = (event.target as HTMLInputElement).checked;
    this.updateForm(field, value);
  }

  protected async submitPreview(): Promise<void> {
    const form = this.form();
    const timestamp = new Date().toLocaleString('en-US');

    this.eventSource?.close();
    this.status.set('ready');

    const runId = `pending-${Date.now()}`;
    this.history.update((items) => [
      {
        id: runId,
        startedAt: timestamp,
        finishedAt: null,
        target: form.target_port === null ? 'Ceiling check' : form.target_label,
        scenario: form.scenario,
        status: 'running',
        notes: 'Starting…',
        summary: null,
      },
      ...items,
    ]);
    this.logLines.set([
      `${form.target_port === null ? 'ceiling' : `${form.target_label}:${form.target_port}`} · ${form.scenario} · ${form.duration_minutes}min run, ${form.warmup_minutes}min warm-up`,
    ]);

    try {
      const res = await fetch('/api/run-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`Failed to start run: ${res.status}`);
      const { id } = (await res.json()) as { id: string };

      this.history.update((items) => items.map((run) => (run.id === runId ? { ...run, id } : run)));
      this.subscribeToRun(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not reach the backend.';
      this.history.update((items) =>
        items.map((run) => (run.id === runId ? { ...run, status: 'failed', notes: message } : run)),
      );
      this.logLines.update((lines) => [...lines, `Error: ${message}`]);
    }
  }

  private subscribeToRun(id: string): void {
    const source = new EventSource(`/api/run-test/${id}/stream`);
    this.eventSource = source;

    source.addEventListener('update', (event) => {
      const snapshot = JSON.parse((event as MessageEvent).data) as RunSnapshot;
      this.applySnapshot(snapshot);
    });

    source.addEventListener('phase', () => {
      this.logLines.update((lines) => [...lines, 'Warm-up done, measuring now.']);
    });

    source.addEventListener('done', (event) => {
      const snapshot = JSON.parse((event as MessageEvent).data) as RunSnapshot;
      this.applySnapshot(snapshot);
      this.history.update((items) =>
        items.map((run) =>
          run.id === id
            ? {
                ...run,
                status: snapshot.phase === 'failed' ? 'failed' : 'done',
                notes: this.notesFor(snapshot.phase === 'failed' ? 'failed' : 'done', snapshot),
                finishedAt: new Date().toLocaleString('en-US'),
                summary: snapshot,
              }
            : run,
        ),
      );
      this.logLines.update((lines) => [...lines, `Done. Effective RPS ${snapshot.rps} (see §3 disclaimer before treating this as absolute backend capacity).`]);
      source.close();
    });

    source.onerror = () => {
      this.logLines.update((lines) => [...lines, 'Stream disconnected.']);
    };
  }

  protected memoryEntries(memory: Record<string, number> | null): Array<{ key: string; value: number }> {
    if (!memory) return [];
    return Object.entries(memory).map(([key, value]) => ({ key, value }));
  }

  private summarizeMemory(memory: Record<string, number> | null): { value: string; hint: string } {
    if (!memory) return { value: '—', hint: 'not reported by target' };
    const entries = Object.entries(memory);
    const primaryKey = ['rssMB', 'heapUsedMB'].find((k) => k in memory) ?? entries[0]?.[0];
    const primary = primaryKey ? memory[primaryKey] : undefined;
    const rest = entries
      .filter(([key]) => key !== primaryKey)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    return { value: primary !== undefined ? `${primary} MB` : '—', hint: rest };
  }

  private applySnapshot(snapshot: RunSnapshot): void {
    const isCeiling = snapshot.generatorCeilingRps !== null;
    const memory = this.summarizeMemory(snapshot.memory);
    this.metricCards.set([
      { label: 'Effective RPS', value: `${snapshot.rps}`, hint: `${snapshot.phase} · ${Math.round(snapshot.elapsedMs / 1000)}s`, color: METRIC_COLORS[0] },
      { label: 'p95 latency', value: `${snapshot.latency.p95} ms`, hint: `mean ${snapshot.latency.meanMs} ms`, color: METRIC_COLORS[1] },
      { label: 'p99 latency', value: `${snapshot.latency.p99} ms`, hint: `max ${snapshot.latency.maxMs} ms`, color: METRIC_COLORS[2] },
      { label: 'Requests', value: `${snapshot.totals.ok}/${snapshot.totals.sent}`, hint: `${snapshot.totals.failed} failed`, color: METRIC_COLORS[3] },
      { label: 'Memory', value: memory.value, hint: memory.hint, color: METRIC_COLORS[4] },
      {
        label: 'Generator ceiling',
        value: isCeiling
          ? `${snapshot.generatorCeilingRps} rps`
          : snapshot.referenceCeilingRps
            ? `${snapshot.referenceCeilingRps} rps (last)`
            : 'Not measured',
        hint: 'validate before comparing backends',
        color: METRIC_COLORS[5],
      },
      { label: 'Status', value: snapshot.phase, hint: '', color: METRIC_COLORS[6] },
    ]);
  }

  protected scenarioColor(value: Scenario): string {
    return scenarios.find((s) => s.value === value)?.color ?? 'ink-faint';
  }

  protected borderClass(color: string): string {
    return COLOR_BORDER[color] ?? 'border-line';
  }

  protected textClass(color: string): string {
    return COLOR_TEXT[color] ?? 'text-ink-faint';
  }

  protected dotClass(color: string): string {
    return COLOR_DOT[color] ?? 'bg-ink-faint';
  }

  protected statusLabel(): string {
    return this.status() === 'ready' ? 'Running' : 'Idle';
  }

  protected historyStatusLabel(): string {
    return this.history().length > 0 ? 'Synced' : 'No runs';
  }

  protected updateForm<K extends keyof BenchmarkForm>(field: K, value: BenchmarkForm[K]): void {
    this.form.update((current) => ({
      ...current,
      [field]: value,
    }));
  }
}
