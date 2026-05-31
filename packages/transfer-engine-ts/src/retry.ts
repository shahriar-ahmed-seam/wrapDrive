/**
 * Retry policy for chunk uploads.
 *
 * Mirrors section 6.2 of the protocol spec: a transient failure (timeout or
 * HTTP 5xx) is retried with exponential backoff starting at 500 ms, doubling,
 * capped at 16 s, for up to 5 retry attempts. An HTTP 4xx is non-retriable.
 */

/** Default retry parameters; overridable for tests. */
export interface RetryPolicy {
  /** Maximum number of retry attempts after the initial try. */
  maxRetries: number;
  /** Initial backoff delay in milliseconds. */
  initialBackoffMs: number;
  /** Maximum backoff delay in milliseconds. */
  maxBackoffMs: number;
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs: number;
}

/** The protocol-default retry policy. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5,
  initialBackoffMs: 500,
  maxBackoffMs: 16_000,
  requestTimeoutMs: 30_000,
};

/**
 * Backoff delay (ms) before retry attempt `attempt` (1-based): 500, 1000, 2000,
 * 4000, 8000, capped at {@link RetryPolicy.maxBackoffMs}.
 */
export function backoffDelayMs(attempt: number, policy: RetryPolicy): number {
  const raw = policy.initialBackoffMs * 2 ** (attempt - 1);
  return Math.min(raw, policy.maxBackoffMs);
}

/** Whether an HTTP-style status is a retriable transient server error (5xx). */
export function isRetriableStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

/** Whether an HTTP-style status is a non-retriable client error (4xx). */
export function isClientErrorStatus(status: number): boolean {
  return status >= 400 && status <= 499;
}
