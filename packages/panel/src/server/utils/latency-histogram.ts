// Histogram bucket sederhana untuk p50/p95/p99 (§5.5 README) — menghindari
// menyimpan tiap sample mentah di array besar (memory + sort cost jadi noise
// tambahan buat observer effect saat volume request ribuan+).
const BUCKET_WIDTH_MS = 5;
const BUCKET_COUNT = 400; // menutup 0..2000ms, sisanya masuk overflow bucket

export class LatencyHistogram {
  private buckets = new Uint32Array(BUCKET_COUNT + 1); // index terakhir = overflow
  private count = 0;
  private sum = 0;
  private max = 0;

  record(latencyMs: number): void {
    const index = Math.min(Math.floor(latencyMs / BUCKET_WIDTH_MS), BUCKET_COUNT);
    this.buckets[index]++;
    this.count++;
    this.sum += latencyMs;
    if (latencyMs > this.max) this.max = latencyMs;
  }

  reset(): void {
    this.buckets.fill(0);
    this.count = 0;
    this.sum = 0;
    this.max = 0;
  }

  get totalSamples(): number {
    return this.count;
  }

  get meanMs(): number {
    return this.count === 0 ? 0 : this.sum / this.count;
  }

  get maxMs(): number {
    return this.max;
  }

  percentile(p: number): number {
    if (this.count === 0) return 0;
    const target = Math.ceil((p / 100) * this.count);
    let seen = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      seen += this.buckets[i];
      if (seen >= target) {
        return i === BUCKET_COUNT ? this.max : i * BUCKET_WIDTH_MS;
      }
    }
    return this.max;
  }

  snapshot() {
    return {
      count: this.count,
      meanMs: Math.round(this.meanMs * 100) / 100,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      maxMs: this.max,
    };
  }
}
