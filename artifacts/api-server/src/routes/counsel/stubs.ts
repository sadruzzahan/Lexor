import { Router, type IRouter, type RequestHandler } from "express";
import { HttpError } from "../../middlewares/errorEnvelope";
import { requireAuth } from "../../middlewares/auth";

/**
 * Stub handlers for endpoints whose full implementation lives in feature
 * tasks #3-#11. They satisfy the OpenAPI contract surface so codegen produces
 * usable hooks; calling them returns a clear "not implemented yet" envelope
 * rather than a confusing 404.
 */
function notImplemented(feature: string): RequestHandler {
  return (_req, _res, next) => {
    next(
      new HttpError(
        501,
        "not_implemented",
        `${feature} is not available yet.`,
      ),
    );
  };
}

export const coalitionsRouter: IRouter = Router();
coalitionsRouter.get("/coalitions", notImplemented("Coalitions"));
coalitionsRouter.get("/coalitions/:id", notImplemented("Coalition detail"));
coalitionsRouter.post(
  "/coalitions/:id/join",
  requireAuth,
  notImplemented("Coalition join"),
);
coalitionsRouter.post(
  "/coalitions/:id/bid",
  notImplemented("Coalition lawyer bid"),
);

// Voice + WhatsApp now live in dedicated routers (see ./voice, ./whatsapp).
