import { getAlertsConfig } from '../config/alerts.config';
import { buildAlertPayload } from './alert-sanitizer';
import { sendAlert } from './alert-sender';
import { ALERT_CALL_TIMEOUT_MS } from './constants';

/**
 * Reports a failed start straight to the alert service: there is no application, so no
 * AlertService either. Waits at most ALERT_CALL_TIMEOUT_MS and never rejects, so the caller can
 * always exit afterwards.
 */
export async function sendBootFailureAlert(reason: string): Promise<void> {
  const config = getAlertsConfig();
  if (!config.isEnabled) {
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ALERT_CALL_TIMEOUT_MS);
  try {
    const payload = buildAlertPayload(config.serviceName, 'error', 'Application failed to start', {
      reason,
    });
    await sendAlert(config, payload, controller.signal);
  } catch {
    // The process is exiting anyway; the failed start is already in the log.
  } finally {
    clearTimeout(timer);
  }
}
