import cluster from 'node:cluster';
import os from 'node:os';

// Node.js is single-threaded for non-I/O work (JSON serialize, DTO
// validation, route matching, ORM query building) -- under I/O-bound load
// this doesn't show up until concurrency is high enough that one core
// running the event loop becomes the bottleneck instead of the I/O wait
// itself. Cluster mode forks one worker process per core; each gets its
// own event loop, so that compute layer fans out across cores instead of
// being serialized through one. This is the standard Node scaling pattern
// for CPU-adjacent work under concurrent load (documented in Node's own
// cluster module docs), not something specific to this project.
//
// Only entry point that changes: `node dist/main` still boots a single
// process (used by run-nestjs.sh / start:dev for normal development, where
// forking N processes just adds noise to debugging). This file is a
// separate opt-in entry point for load testing.
const WORKER_COUNT = Number(process.env.CLUSTER_WORKERS ?? os.availableParallelism());

if (cluster.isPrimary) {
  console.log(`[cluster] primary ${process.pid} forking ${WORKER_COUNT} workers`);

  for (let i = 0; i < WORKER_COUNT; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`[cluster] worker ${worker.process.pid} exited (code=${code} signal=${signal}), restarting`);
    cluster.fork();
  });
} else {
  // Each worker imports and runs the normal bootstrap -- this is what
  // actually starts listening on the port. Node's cluster module has all
  // workers share the same listening socket (via the primary), so this is
  // safe to do N times without a "port already in use" conflict.
  void import('./main.js');
}
