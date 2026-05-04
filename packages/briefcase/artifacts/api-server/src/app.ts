import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./middlewares/error";
import "./types";

const app: Express = express();

app.disable("x-powered-by");
// Constrain trust-proxy: in production only trust the loopback hop (typical
// reverse-proxy / sidecar deployment) so an attacker can't spoof
// `X-Forwarded-*` / `Host` to influence signed-URL generation. In dev we
// keep `true` so localhost preview proxies still see the right protocol/host.
app.set(
  "trust proxy",
  process.env["NODE_ENV"] === "production" ? "loopback" : true,
);

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
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use("/api", notFoundHandler);
app.use(errorHandler);

export default app;
