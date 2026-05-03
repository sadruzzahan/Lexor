import { Router, type IRouter } from "express";
import healthzRouter from "./healthz";
import diagnosticsRouter from "./diagnostics";
import casesRouter from "./cases";
import disclosuresRouter from "./disclosures";
import regulatorsRouter from "./regulators";
import adversaryRouter from "./adversary";
import mapRouter from "./map";
import devSeedRouter from "./devSeed";
import voiceRouter from "./voice";
import whatsappRouter from "./whatsapp";
import coalitionsRouter from "./coalitions";
import trialsRouter from "./trials";

const router: IRouter = Router();

router.use(healthzRouter);
router.use(diagnosticsRouter);
router.use(casesRouter);
router.use(disclosuresRouter);
router.use(regulatorsRouter);
router.use(adversaryRouter);
router.use(mapRouter);
router.use(devSeedRouter);

// Voice + WhatsApp — Feature 4 wired through Twilio + OpenAI Realtime.
router.use("/voice", voiceRouter);
router.use("/whatsapp", whatsappRouter);

router.use(coalitionsRouter);
router.use(trialsRouter);

export default router;
