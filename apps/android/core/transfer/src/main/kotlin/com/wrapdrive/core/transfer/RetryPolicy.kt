package com.wrapdrive.core.transfer

/**
 * Retry policy for chunk uploads (Kotlin port).
 *
 * Mirrors section 6.2 of the protocol spec: transient failures (timeout / 5xx)
 * are retried with exponential backoff from 500 ms, doubling, capped at 16 s,
 * for up to 5 attempts; 4xx is non-retriable.
 */
data class RetryPolicy(
    val maxRetries: Int = 5,
    val initialBackoffMs: Long = 500,
    val maxBackoffMs: Long = 16_000,
    val requestTimeoutMs: Long = 30_000,
) {
    /** Backoff delay (ms) before retry [attempt] (1-based). */
    fun backoffMs(attempt: Int): Long {
        val raw = initialBackoffMs shl (attempt - 1)
        return minOf(raw, maxBackoffMs)
    }

    companion object {
        val DEFAULT = RetryPolicy()

        /** Whether an HTTP status is a retriable transient server error (5xx). */
        fun isRetriable(status: Int): Boolean = status in 500..599

        /** Whether an HTTP status is a non-retriable client error (4xx). */
        fun isClientError(status: Int): Boolean = status in 400..499
    }
}
