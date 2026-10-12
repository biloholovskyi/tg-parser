import { TIMEOUT_SUFFIX } from '../constants';

/**
 * Races a call against a timeout and always clears the timer once the call settles,
 * so no timer outlives the request that created it.
 */
export async function withTimeout<T>(
  call: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}${TIMEOUT_SUFFIX}`)), timeoutMs);
  });

  try {
    return await Promise.race([call, expiry]);
  } finally {
    clearTimeout(timer);
  }
}
