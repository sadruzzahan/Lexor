import { Router, type IRouter } from "express";
import { requireAuth } from "../../middlewares/auth";

const router: IRouter = Router();

/**
 * Reports whether each third-party API key is present in the environment.
 * Returns booleans only — never the values themselves. Gated behind Clerk
 * auth so the integration footprint isn't a public reconnaissance surface.
 */
router.get("/_diagnostics", requireAuth, (_req, res) => {
  const keysToCheck = [
    // AI integrations (auto-provisioned via Replit AI Integrations)
    "AI_INTEGRATIONS_ANTHROPIC_BASE_URL",
    "AI_INTEGRATIONS_ANTHROPIC_API_KEY",
    "AI_INTEGRATIONS_OPENAI_BASE_URL",
    "AI_INTEGRATIONS_OPENAI_API_KEY",
    // Auth
    "CLERK_SECRET_KEY",
    "CLERK_PUBLISHABLE_KEY",
    // Storage
    "DEFAULT_OBJECT_STORAGE_BUCKET_ID",
    "PRIVATE_OBJECT_DIR",
    "PUBLIC_OBJECT_SEARCH_PATHS",
    // Database
    "DATABASE_URL",
    // Telephony / messaging (set up via the Twilio connector or raw secrets)
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    // External legal-data providers
    "COURTLISTENER_API_TOKEN",
    "OPENCORPORATES_API_TOKEN",
    "GOVINFO_API_KEY",
    // Voice / TTS
    "DEEPGRAM_API_KEY",
    "ELEVENLABS_API_KEY",
  ] as const;

  const keys: Record<string, boolean> = {};
  for (const k of keysToCheck) {
    keys[k] = Boolean(process.env[k]);
  }

  const integrations = {
    anthropic: Boolean(
      process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL &&
        process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    ),
    openai: Boolean(
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL &&
        process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    ),
    clerk: Boolean(
      process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY,
    ),
    objectStorage: Boolean(
      process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID &&
        process.env.PRIVATE_OBJECT_DIR,
    ),
    twilio: Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN,
    ),
  };

  res.json({ keys, integrations });
});

export default router;
