import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import counselRouter from "./counsel";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use("/counsel", counselRouter);

export default router;
