---
name: redis-cron-fetch-verified-behavior
description: ioredis 6.0.0, cron 3.2.1, @nestjs/schedule 4.1.2 and Node 22 fetch-abort behavior verified from node_modules for block-10 audits
metadata:
  type: reference
---

Verified 2026-09-26. Re-check if versions change.

- ioredis 6.0.0 defaults (built/redis/RedisOptions.js): enableOfflineQueue true, maxRetriesPerRequest 20, connectTimeout 10000, keepAlive 30000, retryStrategy exponential capped 5 s.
- built/Redis.js:368-369: commandTimeout is armed before offline queuing, so queued commands also time out. A timed-out command stays in offlineQueue and is replayed on ready (built/redis/event_handler.js:431-440) unless flushed.
- event_handler.js:326-347: offline queue flushed with MaxRetriesPerRequestError when retryAttempts % (maxRetriesPerRequest+1) === 0; retryStrategy returning a number means reconnect forever.
- ioredis emits no console output if an 'error' listener exists (silentEmit).
- cron 3.2.1 dist/job.js:93-96 fireOnTick uses `void callback()` (no await, no overlap guard, no catch); one setTimeout, not unref'd by default; stop() does not wait for a running tick.
- @nestjs/schedule 4.1.2 scheduler.orchestrator.js:29-33 deletes all cron jobs on onApplicationShutdown.
- Node 22.14 fetch: aborting the signal during response.json() rejects with AbortError (tested with a local stalled-body server), so a timer covering body parsing is effective.

**How to apply:** cite these when auditing src/redis, src/digest; the project uses REDIS_MAX_RETRIES and REDIS_COMMAND_TIMEOUT_MS explicitly.
