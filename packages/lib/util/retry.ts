import type { Logger } from 'pino';
import { isAxiosError } from 'axios';

/**
 * Configuration for retry behaviour
 */
export interface RetryConfig {
	/** Maximum number of retry attempts (default: 3) */
	maxRetries: number;
	/** Initial delay between retries in milliseconds (default: 10,000 - ten seconds) */
	initialDelayMs: number;
	/** Maximum delay between retries in milliseconds (default: 300,000 - five minutes) */
	maxDelayMs: number;
	/** HTTP status codes that should trigger a retry (default: [403, 429, 500, 502, 503, 504]) */
	retryableStatusCodes: number[];
}

/**
 * Default retry configuration aligned with SharePoint API retry logic
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxRetries: 5,
	initialDelayMs: 1000 * 10,
	maxDelayMs: 1000 * 60 * 5,
	retryableStatusCodes: [403, 429, 500, 502, 503, 504]
};

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
	success: boolean;
	result?: T;
	error?: Error;
	attempts: number;
}

/**
 * Check if an error is retryable based on its HTTP status code
 *
 * @param error - The error to check
 * @param retryableStatusCodes - List of HTTP status codes that should trigger a retry
 *
 * @returns true if the error is retryable
 */
export function isRetryableError(error: unknown, retryableStatusCodes: number[]): boolean {
	if (isAxiosError(error)) {
		const statusCode = error.response?.status;
		if (statusCode && retryableStatusCodes.includes(statusCode)) {
			return true;
		}
	}

	// Also check for network errors (no response) which are typically transient
	if (isAxiosError(error) && !error.response && error.code) {
		const networkErrorCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ENETUNREACH'];
		if (networkErrorCodes.includes(error.code)) {
			return true;
		}
	}

	return false;
}

/**
 * Calculate the delay for a given retry attempt using exponential backoff
 *
 * @param attempt - The current attempt number (1-based)
 * @param initialDelayMs - The initial delay in milliseconds
 * @param maxDelayMs - The maximum delay in milliseconds
 *
 * @returns The delay in milliseconds
 */
export function calculateRetryDelay(attempt: number, initialDelayMs: number, maxDelayMs: number): number {
	// Exponential backoff: initialDelay * e^(attempt-1), capped at maxDelay
	const delay = initialDelayMs * Math.pow(Math.E, attempt - 1);
	return Math.min(delay, maxDelayMs);
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry logic
 *
 * @param fn - The async function to execute
 * @param options - Partial retry configuration (uses defaults for unspecified options)
 * @param logger - Logger instance for logging retry attempts
 *
 * @returns The result of the function if successful
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	options: Partial<RetryConfig> = {},
	logger: Logger
): Promise<T> {
	const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...options };
	const { maxRetries, initialDelayMs, maxDelayMs, retryableStatusCodes } = config;

	let lastError: Error | undefined;

	for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
		try {
			const result = await fn();

			if (attempt > 1) {
				logger.info({ attempt, totalAttempts: attempt }, 'Operation succeeded after retry');
			}

			return result;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			const isRetryable = isRetryableError(error, retryableStatusCodes);
			const statusCode = isAxiosError(error) ? error.response?.status : undefined;
			const errorCode = isAxiosError(error) ? error.code : undefined;

			// If we've exhausted all retries or the error is not retryable, throw
			if (attempt > maxRetries || !isRetryable) {
				if (!isRetryable) {
					logger.error(
						{ attempt, statusCode, errorCode, error: lastError },
						'Operation failed with non-retryable error'
					);
				} else {
					logger.error(
						{ attempt, maxRetries, statusCode, errorCode, error: lastError },
						`Operation failed after ${maxRetries} retry attempts`
					);
				}
				throw lastError;
			}

			// Calculate delay and log the retry attempt
			const delay = calculateRetryDelay(attempt, initialDelayMs, maxDelayMs);

			logger.warn(
				{ attempt, maxRetries, delay, statusCode, errorCode },
				`Retryable error encountered, retrying in ${delay}ms`
			);

			await sleep(delay);
		}
	}

	// This should never be reached, but TypeScript needs it
	throw lastError ?? new Error('Retry failed with unknown error');
}

/**
 * Execute an async function with retry logic, returning a result object instead of throwing
 *
 * @param fn - The async function to execute
 * @param options - Partial retry configuration (uses defaults for unspecified options)
 * @param logger - Logger instance for logging retry attempts
 *
 * @returns A RetryResult object containing success status, result/error, and attempt count
 */
export async function withRetryResult<T>(
	fn: () => Promise<T>,
	options: Partial<RetryConfig> = {},
	logger: Logger
): Promise<RetryResult<T>> {
	try {
		const result = await withRetry(fn, options, logger);
		return {
			success: true,
			result,
			attempts: 1 // Note: actual attempts logged in withRetry
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error : new Error(String(error)),
			attempts: (options.maxRetries ?? DEFAULT_RETRY_CONFIG.maxRetries) + 1
		};
	}
}
