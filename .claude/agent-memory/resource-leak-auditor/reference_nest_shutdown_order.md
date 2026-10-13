---
name: nest-shutdown-order-verified
description: Nest 10.4.20 close() phase order and the actual hook order of tg-parser modules (Alerts drains last), plus undici Agent.close waiting on in-flight requests
metadata:
  type: reference
---

Verified 2026-10-13 (@nestjs/core 10.4.20, undici 6.29.0, Node 24.21).

- nest-application-context.js:118-125: close = onModuleDestroy (all) -> beforeApplicationShutdown -> dispose (HTTP server close) -> onApplicationShutdown; modules sorted by distance descending (:284-290), sequential per module.
- Simulated with stub modules of the same graph (scratch script, no env): TelegramService.onModuleDestroy -> GrokClient -> DigestScheduler -> HTTP close -> RedisModule.onApplicationShutdown -> AlertService.onApplicationShutdown. Global AlertsModule stays at distance 1, so it runs last in every phase.
- undici client.js:327-336: Agent.close() waits for in-flight requests (GrokClient up to GROK_SUMMARY_TIMEOUT_MS), so it can consume the whole SHUTDOWN_TIMEOUT_MS.
- undici web/fetch/body.js:35-39: unread fetch bodies are released only by FinalizationRegistry (GC).

**How to apply:** re-run a stub-module simulation if modules or imports change; flag any shutdown hook that can outlast SHUTDOWN_TIMEOUT_MS minus ALERT_DRAIN_TIMEOUT_MS.
