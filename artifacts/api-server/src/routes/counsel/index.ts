import { Router, type IRouter } from "express";
import healthzRouter from "./healthz";
import diagnosticsRouter from "./diagnostics";
import casesRouter from "./cases";
import disclosuresRouter from "./disclosures";
import regulatorsRouter from "./regulators";
import adversaryRouter from "./adversary";
import mapRouter from "./map";
import devSeedRouter from "./devSeed";
import {
  coalitionsRouter,
  voiceRouter,
  whatsappRouter,
} from "./stubs";

const router: IRouter = Router();

router.use(healthzRouter);
router.use(diagnosticsRouter);
router.use(casesRouter);
router.use(disclosuresRouter);
router.use(regulatorsRouter);

// Stubs — full implementations land in their respective feature tasks.
router.use(adversaryRouter);
router.use(mapRouter);
router.use(devSeedRouter);
router.use(coalitionsRouter);
router.use("/voice", voiceRouter);
router.use("/whatsapp", whatsappRouter);

export default router;
