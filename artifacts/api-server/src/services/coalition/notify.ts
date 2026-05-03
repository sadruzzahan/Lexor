import {
  db,
  coalitionsTable,
  coalitionMembersTable,
  casesTable,
  sessionsTable,
  notificationsTable,
  entitiesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { sendWhatsApp } from "../voice/twilioClient";

const RATE_CAP_MS = 30 * 1000;
const lastSendByCoalition = new Map<string, number>();

function publicBase(): string {
  const host = (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim();
  return host ? `https://${host}` : process.env.PUBLIC_BASE_URL ?? "";
}

export const COALITION_DISCLAIMER_VERSION = "coalition-v1";
const DISCLAIMER = `Joining a coalition does not commit you to a lawsuit. A vetted plaintiff's lawyer may contact you. Lexor is not your lawyer and takes 0% of any recovery. You can leave at any time.`;

/**
 * Fan out coalition invitations across in-app inbox, email, and WhatsApp.
 * Best-effort: each channel may degrade independently. Rate-capped to one
 * full fan-out per coalition per RATE_CAP_MS so a noisy retry loop can't
 * spam members.
 */
export async function fanOutCoalitionInvites(coalitionId: string): Promise<{
  inappCount: number;
  emailCount: number;
  whatsappCount: number;
  skipped?: "rate_capped";
}> {
  const last = lastSendByCoalition.get(coalitionId) ?? 0;
  if (Date.now() - last < RATE_CAP_MS) {
    logger.info({ coalitionId }, "coalition fan-out rate-capped");
    return { inappCount: 0, emailCount: 0, whatsappCount: 0, skipped: "rate_capped" };
  }
  lastSendByCoalition.set(coalitionId, Date.now());

  const [coalition] = await db
    .select()
    .from(coalitionsTable)
    .where(eq(coalitionsTable.id, coalitionId))
    .limit(1);
  if (!coalition) {
    logger.warn({ coalitionId }, "fan-out: coalition not found");
    return { inappCount: 0, emailCount: 0, whatsappCount: 0 };
  }

  const [entity] = await db
    .select({ displayName: entitiesTable.displayName })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, coalition.entityId))
    .limit(1);

  const members = await db
    .select({
      caseId: coalitionMembersTable.caseId,
      userId: casesTable.userId,
      hasOptedIn: coalitionMembersTable.hasOptedIn,
    })
    .from(coalitionMembersTable)
    .innerJoin(casesTable, eq(coalitionMembersTable.caseId, casesTable.id))
    .where(eq(coalitionMembersTable.coalitionId, coalitionId));

  const url = `${publicBase()}/coalition/${coalitionId}`;
  const subject = `You may be eligible for a coalition against ${entity?.displayName ?? "an opposing party"}`;
  const body = `${members.length} people received letters similar to yours. ${DISCLAIMER} Review and decide: ${url}`;

  let inapp = 0;
  let email = 0;
  let wa = 0;

  for (const m of members) {
    // 1. In-app inbox row (always).
    try {
      await db.insert(notificationsTable).values({
        caseId: m.caseId,
        userId: m.userId,
        kind: "coalition_invite",
        channel: "inapp",
        payload: {
          coalitionId,
          subject,
          body,
          url,
          disclaimerVersion: COALITION_DISCLAIMER_VERSION,
          disclaimer: DISCLAIMER,
        },
      });
      inapp += 1;
    } catch (err) {
      logger.warn({ err, caseId: m.caseId }, "in-app notification insert failed");
    }

    // 2. Email — only when an outbound email provider is configured.
    // The flag is `LEXOR_EMAIL_PROVIDER`. When unset, we skip entirely
    // (no audit row, no log spam) — the feature is gated off.
    if (m.userId && process.env.LEXOR_EMAIL_PROVIDER) {
      try {
        await db.insert(notificationsTable).values({
          caseId: m.caseId,
          userId: m.userId,
          kind: "coalition_invite",
          channel: "email",
          payload: {
            coalitionId,
            subject,
            body,
            url,
            status: "queued",
          },
        });
        email += 1;
      } catch (err) {
        logger.warn({ err, caseId: m.caseId }, "email notification queue failed");
      }
    }

    // 3. WhatsApp INVITE — this is the channel we use to *ask* a member to
    // join the coalition, so it MUST fire before opt-in. Eligibility is:
    //   (a) the case has an existing WhatsApp session — meaning the user
    //       previously initiated WhatsApp contact with us, which is the
    //       inbound consent for outbound WhatsApp comms, AND
    //   (b) we hold a hashed phone for that session (the routing key).
    // Member-specific outbound routing: when per-member numbers become
    // available we'll thread them here; today the only sanctioned
    // destination is `LEXOR_WA_TEST_NUMBER`. If unset, we skip the send
    // and log the policy decision (we still recorded the in-app row).
    try {
      const [sess] = await db
        .select({ phoneNumberHash: sessionsTable.phoneNumberHash })
        .from(sessionsTable)
        .where(
          and(
            eq(sessionsTable.caseId, m.caseId),
            eq(sessionsTable.channel, "whatsapp"),
          ),
        )
        .limit(1);
      if (!sess?.phoneNumberHash) continue;

      const liveTo = process.env.LEXOR_WA_TEST_NUMBER;
      if (!liveTo) {
        logger.info(
          { caseId: m.caseId, coalitionId },
          "whatsapp send skipped: no per-member outbound destination configured",
        );
        continue;
      }
      await sendWhatsApp({ to: liveTo, body: `${subject}\n\n${body}` });
      await db.insert(notificationsTable).values({
        caseId: m.caseId,
        userId: m.userId,
        kind: "coalition_invite",
        channel: "whatsapp",
        payload: {
          coalitionId,
          subject,
          body,
          url,
          phoneHash: sess.phoneNumberHash,
          status: "sent",
        },
      });
      wa += 1;
    } catch (err) {
      logger.warn({ err, caseId: m.caseId }, "whatsapp notification failed");
    }
  }

  logger.info(
    { coalitionId, inapp, email, wa, members: members.length },
    "coalition fan-out complete",
  );
  return { inappCount: inapp, emailCount: email, whatsappCount: wa };
}
