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

export const adversaryRouter: IRouter = Router();
adversaryRouter.get("/adversary/search", notImplemented("Adversary search"));
adversaryRouter.get(
  "/adversary/:entityId",
  notImplemented("Adversary dossier"),
);

export const mapRouter: IRouter = Router();
mapRouter.get("/map/markers", notImplemented("Predator map"));
mapRouter.get("/map/entity/:id", notImplemented("Predator map"));

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

// Voice + WhatsApp routers are mounted under their own subpath in index.ts.
export const voiceRouter: IRouter = Router();
voiceRouter.post("/incoming", notImplemented("Voice incoming"));
voiceRouter.get("/stream", notImplemented("Voice stream bridge"));

export const whatsappRouter: IRouter = Router();
whatsappRouter.post("/inbound", notImplemented("WhatsApp inbound"));
whatsappRouter.get("/qrcode", notImplemented("WhatsApp QR code"));
