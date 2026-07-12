import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// NOT pinned to the same literal number as the other backends' pools --
// tried that (all backends at max: 50) and it made Node's own throughput
// *worse* under load, most likely from added contention on Postgres itself
// once every backend could push far more concurrent queries than the
// single-process baseline that happened to work well before. See
// _docs/springkt-run-modes.md for the same finding on the Spring/HikariCP
// side and why "same number everywhere" turned out to be its own bias.
//
// Sized per Node *process*, not per app: in cluster mode (see cluster.ts)
// each worker gets its own PrismaService/pool, so DB_POOL_TOTAL is spread
// across CLUSTER_WORKERS processes rather than applied per-process --
// otherwise N workers x a flat per-process number could multiply well past
// Postgres's max_connections. Single-process runs (CLUSTER_WORKERS unset)
// get the whole budget.
const DB_POOL_TOTAL = Number(process.env.DB_POOL_TOTAL ?? 20);
const WORKER_COUNT = Number(process.env.CLUSTER_WORKERS ?? 1);
const DB_POOL_MAX = Math.max(1, Math.floor(DB_POOL_TOTAL / WORKER_COUNT));

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        max: DB_POOL_MAX,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
