import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import {
  errorEnvelopeHandler,
  notFoundHandler,
} from "./middlewares/errorEnvelope";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk's proxy middleware streams raw bytes — must run before body parsers.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Clerk middleware reads CLERK_SECRET_KEY / CLERK_PUBLISHABLE_KEY from env.
// Only mount when the secret key is actually present — without it Clerk
// throws on every request and takes down all routes.
if (process.env.CLERK_SECRET_KEY) {
  app.use(clerkMiddleware());
} else {
  logger.warn(
    "CLERK_SECRET_KEY not set — Clerk auth middleware skipped; all requests run as anonymous",
  );
}

app.use("/api", router);

app.use("/api", notFoundHandler());
app.use(errorEnvelopeHandler());

export default app;
