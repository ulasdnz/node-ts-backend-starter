export interface ErrorDetail {
  field: string;
  message: string;
}

export interface SuccessResponse<T, M = undefined> {
  data: T;
  meta?: M;
  message?: string;
}

export interface ErrorResponse {
  error: {
    /** Stable, machine-readable code (an i18n key); clients branch on this, never on `message`. */
    code: string;
    /** Human-readable message in the request's language. */
    message: string;
    details?: ErrorDetail[];
    /** Same value as the X-Trace-Id response header, for support requests and log lookups. */
    traceId?: string;
    /** Development only. */
    stack?: string;
  };
}
