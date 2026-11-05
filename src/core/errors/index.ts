/**
 * An error the API reports to its client as is. `code` is an i18n key: it is returned verbatim as
 * the machine-readable error code and translated into the response message. `details` are the
 * interpolation values for that message.
 */
export class CustomError extends Error {
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(statusCode: number, code: string, details?: Record<string, unknown>) {
    super(code);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/** A request over its rate limit; the error handler turns `retryAfterSeconds` into Retry-After. */
export class RateLimitError extends CustomError {
  public readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(429, 'error.rate_limit_exceeded');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export default CustomError;
