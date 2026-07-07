# Kaliber — Spec v2: Unified AnalogJS Load Tool

> **Perubahan besar dari versi sebelumnya:** arsitektur multi-service (orchestrator terpisah, generator terpisah, kontrol panel terpisah, 3 kandidat frontend dibandingkan) **digantikan** oleh satu aplikasi AnalogJS yang merangkap tiga peran: trigger, generator beban, dan renderer hasil. Tujuan awal "membandingkan 3 frontend" **di-drop dari scope** — proyek ini sekarang murni alat stress-test backend, dibangun dengan AnalogJS.
>
> **Kategori project:** eksplorasi personal/non-serius (sudah disepakati sebelumnya) — bukan basis keputusan stack produksi. Rigor metodologis di bawah standar generator terpisah, dan ini diterima sadar, bukan diabaikan tanpa disadari.

## 1. Tujuan (Revisi)

1. Membandingkan **backend** (NestJS, Spring Boot Kotlin) menerima beban CRUD brutal.
2. Satu aplikasi AnalogJS berfungsi sebagai: (a) form trigger konfigurasi test, (b) generator yang mengirim request ke backend, (c) dashboard render hasil live.
3. Hasil tetap dicatat sebagai referensi personal, **dengan disclaimer eksplisit** soal batasan metodologi (§3).

## 2. Non-Goals

- **Perbandingan render cost antar frontend (Next/Nuxt/Analog) — di-drop.** Kalau nanti mau dihidupkan lagi, itu scope terpisah dari tool ini, bukan digabung.
- Bukan pengukuran kapasitas backend yang presisi laboratorium — lihat disclaimer di §3.
- Bukan uji keamanan.

## 3. Disclaimer Metodologi (wajib dibaca sebelum interpretasi hasil)

| Masalah | Penyebab | Dampak ke hasil |
|---|---|---|
| **Observer effect** | Generator dan renderer chart berjalan di runtime yang sama | RPS yang tercatat kemungkinan lebih rendah dari kapasitas backend asli, karena sebagian CPU/event-loop terpakai render UI |
| **Concurrency ceiling** | Kalau request dikirim dari browser (client-side), dibatasi koneksi per-host browser dan single-thread JS | Angka "brutal load" bisa jadi mencerminkan batas Analog sebagai generator, bukan batas backend |
| **Coordinated omission** | Kalau loop generate request pakai pola tunggu-response-baru-lanjut (closed-loop) | p99/p95 latency under-reported saat backend melambat — tail latency tidak akurat |
| **Tidak reproducible lab-grade** | Semua berjalan di satu device, tidak ada resource isolation ketat antara generator dan renderer | Hasil valid untuk perbandingan relatif Nest vs Spring dalam satu sesi yang sama, **tidak valid** sebagai klaim kapasitas absolut |

**Mitigasi wajib (bukan opsional) — lihat §5.2, §5.3, §5.4.**

## 4. Arsitektur

```
kaliber/
├── analog-app/                    # Satu-satunya aplikasi frontend
│   ├── src/app/                   # Client components: form, dashboard, chart
│   └── src/server/routes/         # Nitro server routes: generator logic (§5)
├── backend/
│   ├── nestjs-api/                 # SUT #1 — CRUD endpoints
│   └── springboot-kotlin-api/      # SUT #2 — CRUD endpoints
├── infra/
│   ├── docker-compose.yml          # Resource limit backend tetap terpisah
│   ├── postgres/
│   └── redis/
└── storage/
    └── results.sqlite              # Hasil test, WAL mode
```

**Catatan kritis:** backend (`nestjs-api`, `springboot-kotlin-api`) **tetap** harus berjalan di container terpisah dengan resource limit tetap dari `docker-compose` — prinsip isolasi SUT ini **tidak berubah** walau sisi generator sekarang disederhanakan. Yang disederhanakan cuma sisi tooling generator/orchestrator/UI, bukan sisi backend yang diuji.

## 5. Generator Logic di dalam AnalogJS

### 5.1 Wajib jalan di server route (Nitro), bukan client component

Jangan taruh loop pengiriman request brutal di dalam komponen Angular yang jalan di browser. Gunakan **Nitro server route** (`src/server/routes/run-test.ts`) sebagai tempat generator berjalan — ini proses Node di sisi server Analog, bukan di tab browser user.

**Alasan:** menghindari concurrency ceiling browser (koneksi per-host, single-thread UI-blocking) yang dijelaskan di §3. Server route Node bisa jalankan banyak `fetch` konkuren dengan event loop non-blocking, kapasitasnya jauh lebih realistis untuk "brutal load" dibanding dari tab browser.

Client component (dashboard) **hanya**:
- Kirim `POST` ke server route sendiri untuk mulai test
- Subscribe ke event stream (SSE) dari server route yang sama untuk update live
- Render chart

### 5.2 Wajib open-loop, bukan closed-loop naive

**Jangan** tulis seperti ini (closed-loop, rawan coordinated omission):
```
for (let i = 0; i < total; i++) {
  await fetch(target);   // tunggu selesai baru lanjut — SALAH
}
```

**Gunakan pendekatan concurrency-pool dengan interval terjadwal:**
```
// Kirim request setiap intervalMs, tidak peduli response sebelumnya sudah selesai
setInterval(() => {
  fetch(target).then(recordResult).catch(recordError);
}, intervalMs);
```
Ini tetap bukan open-loop sekelas k6/Gatling (belum ada precise scheduling di level microsecond), tapi **jauh lebih representatif** dibanding tunggu-response-baru-lanjut. Catat di hasil bahwa presisi timing ini "best-effort Node timer", bukan real-time scheduler.

### 5.3 Decouple: rate generate request vs rate update UI

**Wajib pisahkan dua interval berbeda:**
- `requestIntervalMs` — seberapa sering request dikirim ke backend (menentukan RPS target)
- `uiUpdateIntervalMs` — seberapa sering data dikirim ke dashboard untuk re-render chart (disarankan lebih jarang, misal tiap 500ms-1s, terlepas dari `requestIntervalMs`)

Kalau kedua rate ini disamakan (setiap request langsung trigger re-render), observer effect di §3 akan jauh lebih parah. Aggregasi dulu di buffer, baru push ke UI di interval yang lebih longgar.

### 5.4 Validasi kapasitas Analog sendiri sebelum percaya hasil sebagai "kapasitas backend"

**Wajib dilakukan sebelum sesi test serius:** jalankan generator ke endpoint dummy yang responnya instan (`return 200` tanpa logic apa pun), ukur RPS maksimum yang bisa dicapai Analog sendiri. Angka ini adalah **ceiling generator**. Kalau nanti hasil test ke Nest/Spring mendekati angka ceiling ini, itu tanda kamu mengukur kapasitas Analog, bukan kapasitas backend — bukan kesimpulan valid soal backend mana yang lebih cepat.

### 5.5 Percentile calculation

Simpan response time tiap request ke array/buffer in-memory selama test berjalan. Untuk hitung p50/p95/p99, gunakan pendekatan histogram/bucket sederhana kalau volume data besar (ribuan+ sample) — sort-array-lalu-index untuk data besar itu memory-heavy dan bisa menambah observer effect (CPU dipakai sorting, bukan generate request).

## 6. Skenario CRUD (Backend)

| Skenario | Endpoint | Yang di-stress |
|---|---|---|
| `create_brutal` | `POST /resource` beruntun | Insert throughput, connection pool saturation |
| `read_light` | `GET /resource/:id` | Overhead routing + serialization murni |
| `read_heavy` | `GET /resource?filter&sort&page` | Query planner, N+1 risk, connection pool |
| `update_brutal` | `PUT /resource/:id` beruntun | Row lock contention, index update cost |
| `delete_brutal` | `DELETE /resource/:id` beruntun | Cascade delete cost (kalau ada relasi) |
| `mixed_crud` | Kombinasi keempatnya secara acak/weighted | Representasi beban CRUD nyata, bukan single-operation murni |

**Wajib tetap berlaku (tidak berubah dari versi sebelumnya):**
- Production build backend, bukan dev mode
- Warm-up period minimal 2 menit sebelum measurement window
- Resource limit (CPU/RAM) Nest vs Spring Boot disamakan via `docker-compose`
- Connection pool dikonfigurasi manual, disamakan proporsinya
- Skenario read berat wajib punya versi raw SQL kontrol (bypass ORM)

## 7. Metrik

- RPS (effective — catat sebagai "effective RPS via Analog generator", bukan "kapasitas backend murni", sesuai disclaimer §3)
- Latency p50/p95/p99 (dengan catatan limitasi coordinated omission dari §5.2)
- Memory backend (heap vs RSS terpisah, seperti versi sebelumnya)
- GC pause count (Spring Boot, via Actuator)
- **Generator ceiling** (dari §5.4) — wajib dicatat berdampingan dengan setiap hasil, sebagai konteks interpretasi

## 8. Form Trigger (Client Component AnalogJS)

```yaml
target_backend: [nestjs, springboot-kotlin]
scenario: [create_brutal, read_light, read_heavy, update_brutal, delete_brutal, mixed_crud]
duration_minutes: number
warmup_minutes: number              # default 2
request_interval_ms: number          # menentukan target RPS
ui_update_interval_ms: number        # default 500-1000, terpisah dari request_interval_ms
database:
  postgresql_enabled: boolean
  redis_enabled: boolean
raw_sql_mode: boolean
```

## 9. Storage: SQLite

- `storage/results.sqlite`, **WAL mode wajib** (`PRAGMA journal_mode=WAL;`)
- Skema:

```sql
CREATE TABLE test_runs (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,           -- 'nestjs' | 'springboot-kotlin'
  scenario TEXT NOT NULL,
  status TEXT NOT NULL,           -- 'running' | 'done' | 'failed'
  started_at INTEGER,
  finished_at INTEGER,
  generator_ceiling_rps REAL,     -- hasil validasi §5.4, wajib diisi
  summary_json TEXT               -- rps, p50/p95/p99, memory, dst
);
```

## 10. Urutan Build

1. Setup `docker-compose.yml` untuk Postgres, Redis, dan dua backend dengan resource limit tetap
2. Build kedua backend (NestJS, Spring Boot Kotlin) dengan endpoint CRUD dasar sesuai §6
3. Build `analog-app` Nitro server route (`run-test.ts`) — generator logic sesuai §5.1-§5.3
4. **Validasi generator ceiling (§5.4) ke endpoint dummy dulu** — jangan lanjut ke backend asli sebelum ini selesai dan dicatat
5. Build client component form trigger (§8) dan dashboard live chart
6. Setup SQLite WAL + skema (§9)
7. Jalankan skenario `read_light` dulu end-to-end ke satu backend, validasi seluruh pipeline (form → server route → backend → SSE ke chart → simpan SQLite)
8. Duplikasi ke backend kedua, tambahkan skenario CRUD lain satu per satu

## 11. Risiko & Checklist Wajib

- [ ] **Generator ceiling harus divalidasi dan dicatat sebelum klaim hasil apa pun soal backend**
- [ ] Request generation **wajib** di Nitro server route, bukan client component browser
- [ ] `requestIntervalMs` dan `uiUpdateIntervalMs` wajib decoupled, tidak boleh disamakan
- [ ] Setiap laporan hasil wajib disertai disclaimer §3 — jangan sebut ini "kapasitas backend murni" tanpa konteks
- [ ] Definisikan isolation level Postgres untuk skenario `update_brutal`/`create_brutal` (race condition behavior beda tergantung READ COMMITTED vs SERIALIZABLE)
- [ ] Kalau nanti ingin mengembalikan tujuan awal "bandingkan 3 frontend", itu perlu dokumen terpisah — jangan dicampur kembali ke tool CRUD-stress ini