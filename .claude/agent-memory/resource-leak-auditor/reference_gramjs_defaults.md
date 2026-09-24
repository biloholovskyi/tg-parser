---
name: gramjs-verified-defaults
description: GramJS 2.26.22 defaults and lifecycle facts verified from node_modules (floodSleep, retries, logger, ping loop, destroy vs disconnect)
metadata:
  type: reference
---

Verified 2026-09-23 against node_modules/telegram 2.26.22. Re-check if the package version changes.

- client/telegramBaseClient.js clientParamsDefault: floodSleepThreshold 60, connectionRetries Infinity, requestRetries 5, retryDelay 1000, autoReconnect true, timeout 10.
- extensions/Logger.js: default level info, writes straight to console (bypasses Nest Logger) unless `baseLogger` is passed.
- client/updates.js _updateLoop: ping every 9000 ms while !client._destroyed; on ping failure console.error + sender.reconnect(); GetState when idle >30 min.
- destroy() sets _destroyed (stops loop); disconnect() alone does NOT stop the loop — release must use destroy().
- getMessages limit <=100 → one GetHistory, waitTime 0 (client/messages.js).
- network/MTProtoSender.js: `connectTimeout` (client `timeout` option) is stored at :54 but never read; TCP connect has no timeout without a proxy. connect() loops `_retries` attempts without checking userDisconnected, so attempts continue after an outer timeout + destroy() (verified 2026-09-24).
- Failed ping (updates.js:204) and failed connect attempt both call console.error(err) at ERROR level, so baseLogger ERROR does not silence stack traces.

**How to apply:** cite these files when auditing client options; flag missing baseLogger as log-volume cost.
