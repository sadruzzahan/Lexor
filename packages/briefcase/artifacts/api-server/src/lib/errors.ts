export type ErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "not_implemented"
  | "dependency_unavailable"
  | "internal_error";

const STATUS_FOR: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  not_implemented: 501,
  dependency_unavailable: 503,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Array<Record<string, unknown>>;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Array<Record<string, unknown>>,
  ) {
    super(message);
    this.code = code;
    this.status = STATUS_FOR[code];
    this.details = details;
  }
}

export function errorEnvelope(
  code: ErrorCode,
  message: string,
  details?: Array<Record<string, unknown>>,
) {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

export function statusForCode(code: ErrorCode): number {
  return STATUS_FOR[code];
}
