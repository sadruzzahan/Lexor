import { Router, type IRouter } from "express";
import healthRouter from "./health";
import casesRouter from "./cases";
import filesRouter, { storageRouter } from "./files";
import runsRouter from "./runs";
import authRouter from "./auth";
import observabilityRouter from "./observability";
import courtroomRouter from "./courtroom";

const router: IRouter = Router();

// Health is unauthenticated.
router.use(healthRouter);

router.use("/v1/cases", casesRouter);
router.use("/v1/cases", filesRouter);
router.use("/v1/files", storageRouter);
router.use("/v1", runsRouter);
router.use("/v1", observabilityRouter);
router.use("/v1/auth", authRouter);
router.use("/v1/courtroom", courtroomRouter);

export default router;
