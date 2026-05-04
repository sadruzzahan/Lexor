import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { ApiError, errorEnvelope } from "../lib/errors";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(
    errorEnvelope("not_found", "Route not found"),
  );
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Multer file-size etc → wrap as validation_error
  if (err && typeof err === "object" && "code" in err && err.code === "LIMIT_FILE_SIZE") {
    res.status(400).json(errorEnvelope("validation_error", "File too large"));
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json(
      errorEnvelope("validation_error", "Request validation failed", [
        { issues: err.issues as unknown as Record<string, unknown>[] } as Record<string, unknown>,
      ]),
    );
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.status).json(
      errorEnvelope(err.code, err.message, err.details),
    );
    return;
  }

  req.log?.error({ err }, "Unhandled error");
  res.status(500).json(
    errorEnvelope("internal_error", "Internal server error"),
  );
};
