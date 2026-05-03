import {
  db,
  casesTable,
  coalitionsTable,
  coalitionMembersTable,
  entitiesTable,
} from "@workspace/db";
import { and, eq, gte, sql, ne, inArray } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { draftClassComplaint } from "./draft";
import { fanOutCoalitionInvites } from "./notify";

const SIM_THRESHOLD = 0.85;
const WINDOW_DAYS = 90;
const MIN_MATCHES = 5;

export interface CoalitionMatchResult {
  coalitionId: string | null;
  matchedCaseIds: string[];
  reason:
    | "no_adversary"
    | "no_embedding"
    | "below_threshold"
    | "joined_existing"
    | "created";
}

/**
 * Try to attach a case to (or form) a coalition.
 *
 * Algorithm:
 *   1. Bail when the case has no adversaryEntityId or embedding — both are
 *      required for a meaningful nearest-neighbor query.
 *   2. Find peer cases with the same adversary in the last 90 days whose
 *      letter embedding has cosine similarity >= 0.85 to ours (`<=>` is
 *      cosine distance in pgvector, so we negate to get similarity).
 *   3. If an open coalition already exists for this entity, attach the
 *      case as a member and bump caseCount. We DO NOT auto-opt-in — the
 *      user must explicitly join through the UI to consent to be part of
 *      a class action (disclosure wall).
 *   4. Otherwise, if peers >= 5 (including this case), create a new
 *      coalition in `forming` status, attach all peers, draft the class
 *      complaint, flip to `open`, and fan out invites.
 */
export async function matchOrFormCoalition(
  caseId: string,
): Promise<CoalitionMatchResult> {
  const [self] = await db
    .select({
      id: casesTable.id,
      adversaryEntityId: casesTable.adversaryEntityId,
      embedding: casesTable.embedding,
      vertical: casesTable.vertical,
      jurisdiction: casesTable.jurisdiction,
      rawDocumentHash: casesTable.rawDocumentHash,
    })
    .from(casesTable)
    .where(eq(casesTable.id, caseId))
    .limit(1);

  if (!self || !self.adversaryEntityId) {
    return { coalitionId: null, matchedCaseIds: [], reason: "no_adversary" };
  }
  if (!self.embedding) {
    return { coalitionId: null, matchedCaseIds: [], reason: "no_embedding" };
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Cosine similarity = 1 - cosine_distance. pgvector exposes `<=>`.
  const embeddingLiteral = sql`${JSON.stringify(self.embedding)}::vector`;
  const peers = await db
    .select({
      id: casesTable.id,
      similarity: sql<number>`1 - (${casesTable.embedding} <=> ${embeddingLiteral})`,
    })
    .from(casesTable)
    .where(
      and(
        eq(casesTable.adversaryEntityId, self.adversaryEntityId),
        ne(casesTable.id, self.id),
        gte(casesTable.createdAt, since),
        sql`${casesTable.embedding} IS NOT NULL`,
      ),
    )
    .orderBy(sql`${casesTable.embedding} <=> ${embeddingLiteral}`)
    .limit(50);

  const similarPeers = peers.filter((p) => p.similarity >= SIM_THRESHOLD);

  // Look for an existing open coalition for this adversary.
  const [existing] = await db
    .select()
    .from(coalitionsTable)
    .where(
      and(
        eq(coalitionsTable.entityId, self.adversaryEntityId),
        inArray(coalitionsTable.status, ["forming", "open"]),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .insert(coalitionMembersTable)
      .values({ coalitionId: existing.id, caseId: self.id, hasOptedIn: false })
      .onConflictDoNothing();
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(coalitionMembersTable)
      .where(eq(coalitionMembersTable.coalitionId, existing.id));
    await db
      .update(coalitionsTable)
      .set({ caseCount: count })
      .where(eq(coalitionsTable.id, existing.id));
    logger.info(
      { coalitionId: existing.id, caseId, count },
      "case attached to existing coalition",
    );
    return {
      coalitionId: existing.id,
      matchedCaseIds: [self.id],
      reason: "joined_existing",
    };
  }

  // Need at least MIN_MATCHES total cases (peers + self).
  if (similarPeers.length + 1 < MIN_MATCHES) {
    return {
      coalitionId: null,
      matchedCaseIds: similarPeers.map((p) => p.id),
      reason: "below_threshold",
    };
  }

  // Create the coalition.
  const [coalition] = await db
    .insert(coalitionsTable)
    .values({
      entityId: self.adversaryEntityId,
      vertical: self.vertical ?? "other",
      jurisdiction: self.jurisdiction,
      letterTemplateHash: self.rawDocumentHash,
      caseCount: similarPeers.length + 1,
      status: "forming",
    })
    .returning();
  if (!coalition) {
    logger.error({ caseId }, "coalition insert returned no row");
    return {
      coalitionId: null,
      matchedCaseIds: [],
      reason: "below_threshold",
    };
  }

  const memberIds = [self.id, ...similarPeers.map((p) => p.id)];
  await db
    .insert(coalitionMembersTable)
    .values(
      memberIds.map((cid) => ({
        coalitionId: coalition.id,
        caseId: cid,
        hasOptedIn: false,
      })),
    )
    .onConflictDoNothing();

  // Draft the class complaint (best-effort) and flip to `open`.
  const [entity] = await db
    .select()
    .from(entitiesTable)
    .where(eq(entitiesTable.id, self.adversaryEntityId))
    .limit(1);
  let classComplaintDraftHtml: string | null = null;
  try {
    classComplaintDraftHtml = await draftClassComplaint({
      coalitionId: coalition.id,
      memberCaseIds: memberIds,
      entityName: entity?.displayName ?? "the opposing party",
      vertical: self.vertical ?? "other",
      jurisdiction: self.jurisdiction,
    });
  } catch (err) {
    logger.warn({ err, coalitionId: coalition.id }, "class complaint draft failed");
  }

  await db
    .update(coalitionsTable)
    .set({ status: "open", classComplaintDraftHtml })
    .where(eq(coalitionsTable.id, coalition.id));

  // Fan out notifications (best-effort; never blocks pipeline).
  fanOutCoalitionInvites(coalition.id).catch((err) =>
    logger.warn({ err, coalitionId: coalition.id }, "fan-out failed"),
  );

  logger.info(
    { coalitionId: coalition.id, members: memberIds.length },
    "coalition formed",
  );
  return {
    coalitionId: coalition.id,
    matchedCaseIds: memberIds,
    reason: "created",
  };
}
