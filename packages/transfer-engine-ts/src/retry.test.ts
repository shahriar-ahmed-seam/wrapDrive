/**
 * Unit tests for the retry policy helpers.
 *
 * Validates: Requirements 3.6, 3.7
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETRY_POLICY,
  backoffDelayMs,
  isClientErrorStatus,
  isRetriableStatus,
} from './retry.js';

describe('retry policy', () => {
  it('uses the protocol-default parameters', () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({
      maxRetries: 5,
      initialBackoffMs: 500,
      maxBackoffMs: 16_000,
      requestTimeoutMs: 30_000,
    });
  });

  it('doubles backoff from 500ms and caps at 16s', () => {
    expect(backoffDelayMs(1, DEFAULT_RETRY_POLICY)).toBe(500);
    expect(backoffDelayMs(2, DEFAULT_RETRY_POLICY)).toBe(1000);
    expect(backoffDelayMs(3, DEFAULT_RETRY_POLICY)).toBe(2000);
    expect(backoffDelayMs(4, DEFAULT_RETRY_POLICY)).toBe(4000);
    expect(backoffDelayMs(5, DEFAULT_RETRY_POLICY)).toBe(8000);
    expect(backoffDelayMs(6, DEFAULT_RETRY_POLICY)).toBe(16_000); // capped
    expect(backoffDelayMs(7, DEFAULT_RETRY_POLICY)).toBe(16_000); // still capped
  });

  it('classifies 5xx as retriable and 4xx as non-retriable', () => {
    expect(isRetriableStatus(500)).toBe(true);
    expect(isRetriableStatus(503)).toBe(true);
    expect(isRetriableStatus(599)).toBe(true);
    expect(isRetriableStatus(404)).toBe(false);
    expect(isRetriableStatus(200)).toBe(false);

    expect(isClientErrorStatus(400)).toBe(true);
    expect(isClientErrorStatus(403)).toBe(true);
    expect(isClientErrorStatus(499)).toBe(true);
    expect(isClientErrorStatus(500)).toBe(false);
  });
});
