export const ALERT_LEVELS = ['info', 'warning', 'error'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

/** Free-form context of an alert; sanitized before it leaves the service. */
export type AlertDetails = Readonly<Record<string, unknown>>;

/** JSON-safe value of sanitized details. */
export type AlertDetailValue =
  | string
  | number
  | boolean
  | null
  | AlertDetailValue[]
  | { [key: string]: AlertDetailValue };

/** Body of `POST /alerts` (`CreateAlertDto` of the alert service). */
export interface AlertPayload {
  serviceName: string;
  level: AlertLevel;
  message: string;
  details?: Record<string, AlertDetailValue>;
}

/**
 * Where code reports alerts. Every method returns at once and never throws; delivery happens
 * in the background and its failure never reaches the caller.
 */
export interface AlertSink {
  info(message: string, details?: AlertDetails): void;
  warning(message: string, details?: AlertDetails): void;
  error(message: string, details?: AlertDetails): void;
}

/** An alert sink the process shutdown path can close before the application stops. */
export interface AlertGate extends AlertSink {
  /** Stops accepting new alerts; alerts already queued are still sent. */
  beginShutdown(): void;
}
