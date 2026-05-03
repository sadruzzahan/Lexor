import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
import { HttpError } from "../middlewares/errorEnvelope";
import { requireAuth } from "../middlewares/auth";
import { rateLimit } from "../middlewares/rateLimit";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Per-IP cap on signed-upload-URL minting. Without this, an unauthenticated
// caller can mint unlimited GCS upload URLs and run up bandwidth/storage
// cost. Mirrors the case-creation limit in counsel/cases.ts.
const uploadUrlLimit = rateLimit({
  windowMs: 60_000,
  max: 20,
  scope: "ip",
  name: "upload-url",
});

/**
 * POST /storage/uploads/request-url
 * Returns a presigned URL for direct PUT upload. Anonymous callers allowed
 * but per-IP rate-limited.
 */
router.post(
  "/storage/uploads/request-url",
  uploadUrlLimit,
  async (req: Request, res: Response, next) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      next(
        new HttpError(
          400,
          "invalid_input",
          "Missing or invalid required fields.",
        ),
      );
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath =
        objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (err) {
      req.log.error({ err }, "failed to generate upload URL");
      next(
        new HttpError(
          500,
          "storage_error",
          "Could not prepare the upload. Please try again.",
        ),
      );
    }
  },
);

/**
 * GET /storage/public-objects/*
 * Serves PUBLIC_OBJECT_SEARCH_PATHS files; unconditionally public.
 */
router.get(
  "/storage/public-objects/*filePath",
  async (req: Request, res: Response, next) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join("/") : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        next(new HttpError(404, "not_found", "File not found."));
        return;
      }

      const response = await objectStorageService.downloadObject(file);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      req.log.error({ err }, "failed to serve public object");
      next(
        new HttpError(500, "storage_error", "Could not serve the requested file."),
      );
    }
  },
);

/**
 * GET /storage/objects/*
 * Private object entities. The foundation deliberately does NOT serve raw
 * private objects — the safe per-case access pattern (case-owner check, or
 * short-lived signed download URL minted from the case detail endpoint)
 * lands with Feature 1. Returning 501 here closes the IDOR surface that a
 * naive "isAuthenticated" gate would still leave open.
 */
router.get(
  "/storage/objects/*path",
  requireAuth,
  (_req: Request, _res: Response, next) => {
    next(
      new HttpError(
        501,
        "not_implemented",
        "Private object reads must go through case-scoped signed URLs (Feature 1).",
      ),
    );
  },
);

export default router;
