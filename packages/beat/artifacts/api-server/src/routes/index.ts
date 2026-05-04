import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import casesRouter from "./cases";
import filesRouter from "./files";
import runsRouter from "./runs";
import draftsRouter from "./drafts";
import artifactsRouter from "./artifacts";
import shareRouter from "./share";
import testSeedRouter from "./testSeed";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(casesRouter);
router.use(filesRouter);
router.use(runsRouter);
router.use(draftsRouter);
router.use(artifactsRouter);
router.use(shareRouter);

// Test-only seeding endpoints — only in non-production environments
if (process.env["NODE_ENV"] !== "production") {
  router.use(testSeedRouter);
}

export default router;
