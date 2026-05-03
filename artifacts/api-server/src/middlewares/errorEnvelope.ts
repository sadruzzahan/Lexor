import type { ErrorRequestHandler, RequestHandler } from "express";

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFoundHandler(): RequestHandler {
  return (req, res) => {
    res.status(404).json({
      error: {
        code: "not_found",
        message: "Not found",
        requestId: req.id,
      },
    });
  };
}

export function errorEnvelopeHandler(): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const isHttp = err instanceof HttpError;
    const status = isHttp ? err.status : 500;
    const code = isHttp ? err.code : "internal_error";
    const message = isHttp
      ? err.message
      : "Something went wrong. Please try again.";

    req.log?.error({ err, status, code }, "request error");

    res.status(status).json({
      error: {
        code,
        message,
        requestId: req.id,
      },
    });
  };
}
