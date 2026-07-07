import { Component, signal } from '@angular/core';

type BackendTarget = 'nestjs' | 'springboot-kotlin';

type Scenario =
  | 'create_brutal'
  | 'read_light'
  | 'read_heavy'
  | 'update_brutal'
  | 'delete_brutal'
  | 'mixed_crud';

interface BenchmarkForm {
  target_backend: BackendTarget;
  scenario: Scenario;
  duration_minutes: number;
  warmup_minutes: number;
  request_interval_ms: number;
  ui_update_interval_ms: number;
  postgresql_enabled: boolean;
  redis_enabled: boolean;
  raw_sql_mode: boolean;
}

interface RunRecord {
  id: string;
  startedAt: string;
  target: BackendTarget;
  scenario: Scenario;
  status: 'draft';
  notes: string;
}

interface MetricCard {
  label: string;
  value: string;
  hint: string;
}

const backendTargets: Array<{ value: BackendTarget; label: string }> = [
  { value: 'nestjs', label: 'NestJS' },
  { value: 'springboot-kotlin', label: 'Spring Boot (Kotlin)' },
];

const scenarios: Array<{ value: Scenario; label: string; description: string }> = [
  { value: 'create_brutal', label: 'Create brutal', description: 'POST beruntun untuk saturasi insert dan pool koneksi.' },
  { value: 'read_light', label: 'Read light', description: 'GET by id untuk jalur routing yang paling ringan.' },
  { value: 'read_heavy', label: 'Read heavy', description: 'Query berfilter dan tersortir untuk menguji planner.' },
  { value: 'update_brutal', label: 'Update brutal', description: 'PUT beruntun untuk lock contention dan update index.' },
  { value: 'delete_brutal', label: 'Delete brutal', description: 'DELETE beruntun untuk beban cascade dan cleanup.' },
  { value: 'mixed_crud', label: 'Mixed CRUD', description: 'Campuran weighted untuk simulasi beban nyata.' },
];

const metricCards: MetricCard[] = [
  { label: 'Effective RPS', value: '—', hint: 'diisi setelah integrasi backend' },
  { label: 'p95 latency', value: '—', hint: 'ms, placeholder sampai generator hidup' },
  { label: 'p99 latency', value: '—', hint: 'tail latency akan tampil di sini' },
  { label: 'Memory', value: '—', hint: 'heap / RSS backend' },
  { label: 'Generator ceiling', value: 'Belum diukur', hint: 'wajib divalidasi sebelum klaim hasil' },
  { label: 'Status stream', value: 'Idle', hint: 'SSE dan sinkronisasi chart nanti' },
];

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: './index.page.html',
})
export default class Home {
  protected readonly backendTargets = backendTargets;

  protected readonly scenarios = scenarios;

  protected readonly metricCards = metricCards;

  protected readonly status = signal<'idle' | 'ready'>('idle');

  protected readonly form = signal<BenchmarkForm>({
    target_backend: 'nestjs',
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

  protected readonly logLines = signal<string[]>([
    'Backend integration belum disambungkan.',
    'Page ini sudah siap dipakai sebagai shell untuk trigger dan dashboard.',
  ]);

  protected updateTargetBackend(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as BackendTarget;
    this.updateForm('target_backend', value);
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

  protected submitPreview(): void {
    const form = this.form();
    const timestamp = new Date().toLocaleString('id-ID');

    this.status.set('ready');
    this.history.update((items) => [
      {
        id: `run-${Date.now()}`,
        startedAt: timestamp,
        target: form.target_backend,
        scenario: form.scenario,
        status: 'draft',
        notes: 'Konfigurasi disiapkan; integrasi backend akan disambungkan berikutnya.',
      },
      ...items,
    ]);
    this.logLines.set([
      `Target ${form.target_backend} dengan skenario ${form.scenario} sudah disiapkan.`,
      `Durasi ${form.duration_minutes} menit, warm-up ${form.warmup_minutes} menit, interval request ${form.request_interval_ms} ms.`,
      `UI refresh ${form.ui_update_interval_ms} ms, PostgreSQL ${form.postgresql_enabled ? 'on' : 'off'}, Redis ${form.redis_enabled ? 'on' : 'off'}, Raw SQL ${form.raw_sql_mode ? 'on' : 'off'}.`,
      'Backend integration dan SSE akan disambungkan nanti.',
    ]);
  }

  protected statusLabel(): string {
    return this.status() === 'ready' ? 'Preview ready' : 'Idle';
  }

  protected historyStatusLabel(): string {
    return this.history().length > 0 ? 'Local draft' : 'Belum ada run';
  }

  protected updateForm<K extends keyof BenchmarkForm>(field: K, value: BenchmarkForm[K]): void {
    this.form.update((current) => ({
      ...current,
      [field]: value,
    }));
  }
}
