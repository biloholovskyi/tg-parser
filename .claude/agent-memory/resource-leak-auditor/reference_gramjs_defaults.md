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

**How to apply:** cite these files when auditing client options; flag missing baseLogger as log-volume cost.
