import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";
import { HttpError } from "../middlewares/errorEnvelope";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 * Returns a presigned URL for direct PUT upload. Anonymous callers allowed
 * (rate-limited at the case-creation layer).
 */
router.post(
  "/storage/uploads/request-url",
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
 * Private object entities. Lexor's full ACL story (case-owner reads, signed
 * download URLs for anonymous-but-token-bearing callers) lands in Feature 1;
 * for the foundation we require an authenticated Clerk session so that
 * uploaded legal documents are not world-readable by URL guess.
 */
router.get(
  "/storage/objects/*path",
  requireAuth,
  async (req: Request, res: Response, next) => {
    try {
      const raw = req.params.path;
      const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
      const objectPath = `/objects/${wildcardPath}`;
      const objectFile =
        await objectStorageService.getObjectEntityFile(objectPath);

      const response = await objectStorageService.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        next(new HttpError(404, "not_found", "Object not found."));
        return;
      }
      req.log.error({ err }, "failed to serve object");
      next(
        new HttpError(500, "storage_error", "Could not serve the requested object."),
      );
    }
  },
);

export default router;
