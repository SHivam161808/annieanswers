/** Stable, non-sensitive error codes returned to callers and written to logs. */
export const ERROR_CODES = {
  unauthorized: 401,
  validation_failed: 400,
  payload_too_large: 413,
  not_found: 404,
  config_unavailable: 404,
  idempotency_key_reuse: 422,
  request_in_progress: 409,
  rate_limited: 429,
  overloaded: 503,
  deadline_exceeded: 504,
  dependency_failed: 502,
  internal_error: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = ERROR_CODES[code];
  }
}
