import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  coalitionsTable,
  coalitionMembersTable,
  lawyerBidsTable,
  coalitionVotesTable,
  casesTable,
  entitiesTable,
  disclosuresTable,
  notificationsTable,
  sessionsTable,
} from "@workspace/db";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { HttpError } from "../../middlewares/errorEnvelope";
import { getUserId } from "../../middlewares/auth";
import { COALITION_DISCLAIMER_VERSION } from "../../services/coalition/notify";

const router: IRouter = Router();

/**
 * Throws 403 if the caller doesn't own the case. Anonymous cases (no userId
 * column set) remain readable from the demo flow; cases tied to a Clerk
 * user must match the request's auth identity.
 */
async function assertCaseOwnership(req: Request, caseId: string): Promise<void> {
  const userId = getUserId(req);
  const [theCase] = await db
    .select({ userId: casesTable.userId })
    .from(casesTable)
    .where(eq(casesTable.id, caseId))
    .limit(1);
  if (!theCase) throw new HttpError(404, "not_found", "Case not found.");
  if (theCase.userId && theCase.userId !== userId) {
    throw new HttpError(403, "forbidden", "Not your case.");
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(id: string, label: string): void {
  if (!UUID_RE.test(id)) {
    throw new HttpError(400, "invalid_input", `Invalid ${label}.`);
  }
}

/**
 * GET /counsel/coalitions
 * List open + forming coalitions, most recent first. Public — anyone can
 * browse open coalitions to discover whether they should join.
 */
router.get("/coalitions", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: coalitionsTable.id,
      entityId: coalitionsTable.entityId,
      entityName: entitiesTable.displayName,
      vertical: coalitionsTable.vertical,
      jurisdiction: coalitionsTable.jurisdiction,
      caseCount: coalitionsTable.caseCount,
      status: coalitionsTable.status,
      createdAt: coalitionsTable.createdAt,
    })
    .from(coalitionsTable)
    .leftJoin(entitiesTable, eq(coalitionsTable.entityId, entitiesTable.id))
    .where(inArray(coalitionsTable.status, ["forming", "open", "matched"]))
    .orderBy(desc(coalitionsTable.createdAt))
    .limit(100);
  res.json({ coalitions: rows });
});

/**
 * GET /counsel/coalitions/:id
 * Detail view: coalition, anonymized members (city/state only), bid list
 * sorted by contingency %, vote tallies. Public read — no PII exposed.
 */
router.get("/coalitions/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  assertUuid(id, "coalitionId");

  const [coalition] = await db
    .select({
      id: coalitionsTable.id,
      entityId: coalitionsTable.entityId,
      entityName: entitiesTable.displayName,
      vertical: coalitionsTable.vertical,
      jurisdiction: coalitionsTable.jurisdiction,
      caseCount: coalitionsTable.caseCount,
      status: coalitionsTable.status,
      classComplaintDraftHtml: coalitionsTable.classComplaintDraftHtml,
      createdAt: coalitionsTable.createdAt,
    })
    .from(coalitionsTable)
    .leftJoin(entitiesTable, eq(coalitionsTable.entityId, entitiesTable.id))
    .where(eq(coalitionsTable.id, id))
    .limit(1);
  if (!coalition) throw new HttpError(404, "not_found", "Coalition not found.");

  // Anonymized members.
  const members = await db
    .select({
      caseId: coalitionMembersTable.caseId,
      hasOptedIn: coalitionMembersTable.hasOptedIn,
      joinedAt: coalitionMembersTable.joinedAt,
      jurisdiction: casesTable.jurisdiction,
      vertical: casesTable.vertical,
    })
    .from(coalitionMembersTable)
    .innerJoin(casesTable, eq(coalitionMembersTable.caseId, casesTable.id))
    .where(eq(coalitionMembersTable.coalitionId, id));

  const anonymizedMembers = members.map((m, i) => ({
    label: `Member #${i + 1}`,
    jurisdiction: m.jurisdiction ?? "—",
    vertical: m.vertical ?? "other",
    hasOptedIn: m.hasOptedIn,
    joinedAt: m.joinedAt,
  }));
  const optedInCount = members.filter((m) => m.hasOptedIn).length;

  // Bids sorted by contingency % asc (lowest take wins user attention).
  const bids = await db
    .select()
    .from(lawyerBidsTable)
    .where(eq(lawyerBidsTable.coalitionId, id))
    .orderBy(lawyerBidsTable.contingencyPercent);

  // Vote tallies.
  const voteRows = await db
    .select({
      bidId: coalitionVotesTable.bidId,
      count: sql<number>`count(*)::int`,
    })
    .from(coalitionVotesTable)
    .where(eq(coalitionVotesTable.coalitionId, id))
    .groupBy(coalitionVotesTable.bidId);
  const voteMap = new Map(voteRows.map((v) => [v.bidId, v.count]));

  const bidsWithVotes = bids.map((b) => ({
    ...b,
    voteCount: voteMap.get(b.id) ?? 0,
  }));

  res.json({
    ...coalition,
    members: anonymizedMembers,
    optedInCount,
    bids: bidsWithVotes,
    disclaimerVersion: COALITION_DISCLAIMER_VERSION,
  });
});

const joinSchema = z.object({
  caseId: z.string().regex(UUID_RE),
  hasOptedIn: z.boolean(),
  disclosureVersion: z.string().min(1),
});

/**
 * POST /counsel/coalitions/:id/join
 * Opt the case into the coalition and record the disclosure. The disclosure
 * row is the audit-grade proof that the user re-read the coalition
 * disclaimer at the moment of opt-in.
 */
router.post(
  "/coalitions/:id/join",
  async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    assertUuid(id, "coalitionId");
    const parsed = joinSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "invalid_input", parsed.error.message);
    }
    // Frontend Clerk wiring is deferred; we accept opt-ins from the case
    // owner identified by Clerk userId when present, and allow anonymous
    // opt-ins for cases that have no userId attached. The disclosure row
    // is still recorded with whatever identity we have.
    const userId = getUserId(req);
    if (!parsed.data.hasOptedIn) {
      throw new HttpError(
        400,
        "invalid_input",
        "Explicit opt-in is required to join a coalition.",
      );
    }
    if (parsed.data.disclosureVersion !== COALITION_DISCLAIMER_VERSION) {
      throw new HttpError(
        400,
        "invalid_input",
        `Disclosure version mismatch — expected ${COALITION_DISCLAIMER_VERSION}.`,
      );
    }

    // Verify the case belongs to the user (only the case owner can opt the
    // case into the coalition).
    const [theCase] = await db
      .select({ userId: casesTable.userId })
      .from(casesTable)
      .where(eq(casesTable.id, parsed.data.caseId))
      .limit(1);
    if (!theCase) throw new HttpError(404, "not_found", "Case not found.");
    // Strict ownership: a case attached to a Clerk user can only be opted-in
    // by that same user. Anonymous cases (no userId on the row) are still
    // joinable by anyone who knows the case UUID — that's the demo path.
    if (theCase.userId && theCase.userId !== userId) {
      throw new HttpError(403, "forbidden", "This case is not yours to opt in.");
    }

    // Confirm membership exists (auto-created at coalition formation).
    const [member] = await db
      .select()
      .from(coalitionMembersTable)
      .where(
        and(
          eq(coalitionMembersTable.coalitionId, id),
          eq(coalitionMembersTable.caseId, parsed.data.caseId),
        ),
      )
      .limit(1);
    if (!member) {
      throw new HttpError(
        404,
        "not_found",
        "This case is not part of the coalition.",
      );
    }

    await db
      .update(coalitionMembersTable)
      .set({ hasOptedIn: true, joinedAt: new Date() })
      .where(
        and(
          eq(coalitionMembersTable.coalitionId, id),
          eq(coalitionMembersTable.caseId, parsed.data.caseId),
        ),
      );

    // Audit-grade disclosure row.
    await db.insert(disclosuresTable).values({
      userId,
      sessionId: parsed.data.caseId,
      version: COALITION_DISCLAIMER_VERSION,
    });

    req.log.info(
      { coalitionId: id, caseId: parsed.data.caseId, userId },
      "coalition opt-in recorded",
    );
    res.json({ ok: true });
  },
);

const bidSchema = z.object({
  lawyerName: z.string().min(1).max(200),
  lawyerBarNumber: z.string().min(1).max(50),
  lawyerEmail: z.string().email(),
  lawyerFirm: z.string().max(200).nullable().optional(),
  contingencyPercent: z.number().min(0).max(100),
  notes: z.string().max(2000).nullable().optional(),
});

/**
 * POST /counsel/coalitions/:id/bid
 * Open marketplace — any lawyer can submit a bid. Identity is self-asserted
 * for v1; bar number verification is manual per spec out-of-scope.
 */
router.post("/coalitions/:id/bid", async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  assertUuid(id, "coalitionId");
  const parsed = bidSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, "invalid_input", parsed.error.message);
  }

  const [coalition] = await db
    .select({ id: coalitionsTable.id, status: coalitionsTable.status })
    .from(coalitionsTable)
    .where(eq(coalitionsTable.id, id))
    .limit(1);
  if (!coalition) throw new HttpError(404, "not_found", "Coalition not found.");
  if (coalition.status === "closed") {
    throw new HttpError(409, "conflict", "This coalition is closed.");
  }

  const [bid] = await db
    .insert(lawyerBidsTable)
    .values({
      coalitionId: id,
      lawyerName: parsed.data.lawyerName,
      lawyerBarNumber: parsed.data.lawyerBarNumber,
      lawyerEmail: parsed.data.lawyerEmail,
      lawyerFirm: parsed.data.lawyerFirm ?? null,
      contingencyPercent: String(parsed.data.contingencyPercent),
      notes: parsed.data.notes ?? null,
    })
    .returning();
  if (!bid) throw new HttpError(500, "internal_error", "Bid insert failed.");

  req.log.info({ coalitionId: id, bidId: bid.id }, "lawyer bid received");
  res.json(bid);
});

const voteSchema = z.object({
  caseId: z.string().regex(UUID_RE),
  bidId: z.string().regex(UUID_RE),
});

/**
 * POST /counsel/coalitions/:id/vote
 * Each opted-in member casts (or replaces) one vote for a bid. Simple
 * plurality: the bid with the most votes wins. Ownership-checked: only
 * the case owner can cast that case's vote.
 */
router.post(
  "/coalitions/:id/vote",
  async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    assertUuid(id, "coalitionId");
    const parsed = voteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "invalid_input", parsed.error.message);
    }
    const userId = getUserId(req);

    const [theCase] = await db
      .select({ userId: casesTable.userId })
      .from(casesTable)
      .where(eq(casesTable.id, parsed.data.caseId))
      .limit(1);
    if (!theCase) throw new HttpError(404, "not_found", "Case not found.");
    // Strict ownership on votes: an authenticated owner is the only one who
    // can cast a case's vote. Anonymous cases are still votable from the
    // demo flow (parity with /join above).
    if (theCase.userId && theCase.userId !== userId) {
      throw new HttpError(403, "forbidden", "Not your case.");
    }

    const [member] = await db
      .select()
      .from(coalitionMembersTable)
      .where(
        and(
          eq(coalitionMembersTable.coalitionId, id),
          eq(coalitionMembersTable.caseId, parsed.data.caseId),
        ),
      )
      .limit(1);
    if (!member || !member.hasOptedIn) {
      throw new HttpError(
        403,
        "forbidden",
        "You must opt in to the coalition before voting.",
      );
    }

    const [bid] = await db
      .select({ id: lawyerBidsTable.id })
      .from(lawyerBidsTable)
      .where(
        and(
          eq(lawyerBidsTable.id, parsed.data.bidId),
          eq(lawyerBidsTable.coalitionId, id),
        ),
      )
      .limit(1);
    if (!bid) throw new HttpError(404, "not_found", "Bid not found.");

    // Upsert: replace any existing vote for (coalition, case).
    await db
      .insert(coalitionVotesTable)
      .values({
        coalitionId: id,
        caseId: parsed.data.caseId,
        bidId: parsed.data.bidId,
      })
      .onConflictDoUpdate({
        target: [coalitionVotesTable.coalitionId, coalitionVotesTable.caseId],
        set: { bidId: parsed.data.bidId, createdAt: new Date() },
      });

    req.log.info(
      { coalitionId: id, caseId: parsed.data.caseId, bidId: parsed.data.bidId, userId },
      "coalition vote recorded",
    );
    res.json({ ok: true });
  },
);

/**
 * POST /counsel/coalitions/:id/finalize
 * Plurality-rule winner selection. PRIVILEGED: requires the
 * `LEXOR_ADMIN_TOKEN` env var presented as `x-admin-token` (operator-
 * triggered or scheduled job only). Never callable by end users.
 *
 * Effects:
 *   - records winningBidId + finalizedAt on the coalition
 *   - flips status → "matched"
 *   - audit-logs one disclosure row per consenting member
 *     (version "coalition-winner-release-v1") so the contact-release is
 *     auditable
 *   - delivers the consenting-member contact list to the winning lawyer
 *     via the controlled in-app `notifications` channel (kind
 *     coalition_update); does NOT return PII in the HTTP response
 */
router.post(
  "/coalitions/:id/finalize",
  async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    assertUuid(id, "coalitionId");

    // Privileged endpoint. We require the operator token; if it is not
    // configured at all the endpoint is locked, refusing finalize until
    // the operator sets one. This prevents accidental public access in
    // any environment.
    const expected = process.env.LEXOR_ADMIN_TOKEN;
    const provided = req.header("x-admin-token");
    if (!expected || !provided || provided !== expected) {
      throw new HttpError(
        403,
        "forbidden",
        "Coalition finalize is operator-only.",
      );
    }

    const [coalition] = await db
      .select()
      .from(coalitionsTable)
      .where(eq(coalitionsTable.id, id))
      .limit(1);
    if (!coalition) {
      throw new HttpError(404, "not_found", "Coalition not found.");
    }
    if (coalition.winningBidId) {
      throw new HttpError(
        409,
        "already_finalized",
        "This coalition has already been finalized.",
      );
    }

    // Tally votes by bid (plurality).
    const tallies = await db
      .select({
        bidId: coalitionVotesTable.bidId,
        votes: sql<number>`count(*)::int`.as("votes"),
      })
      .from(coalitionVotesTable)
      .where(eq(coalitionVotesTable.coalitionId, id))
      .groupBy(coalitionVotesTable.bidId)
      .orderBy(desc(sql`count(*)`));
    const top = tallies[0];
    if (!top) {
      throw new HttpError(
        400,
        "no_votes",
        "No votes have been cast yet — nothing to finalize.",
      );
    }

    const [winningBid] = await db
      .select()
      .from(lawyerBidsTable)
      .where(eq(lawyerBidsTable.id, top.bidId))
      .limit(1);
    if (!winningBid) {
      throw new HttpError(500, "internal_error", "Winning bid is missing.");
    }

    // Pull every opted-in member with the actionable contact channels we
    // hold. We expose:
    //   - caseId               (always — the routing key the lawyer uses
    //                          to reply via Lexor's controlled inbox)
    //   - userId               (Clerk user id when the case is owned, so
    //                          the lawyer's outreach can resolve to a
    //                          verified user identity on our side)
    //   - inboxUrl             (the Lexor-hosted inbox URL the lawyer
    //                          should send substantive comms through —
    //                          this is the canonical lawful channel)
    //   - whatsappPhoneHash    (the *hashed* phone for any case that
    //                          previously initiated WhatsApp comms; the
    //                          lawyer cannot dial a hash, but it lets a
    //                          subsequent operator-side delivery worker
    //                          look up and reach the user via the same
    //                          consented WhatsApp channel)
    //   - language             (so outreach is translated correctly)
    // PII like raw phone numbers and email addresses are intentionally
    // never returned over HTTP nor placed in the lawyer-visible payload;
    // the operator-side delivery worker is the only system that ever
    // resolves a hash to a number.
    const consentedRaw = await db
      .select({
        caseId: coalitionMembersTable.caseId,
        userId: casesTable.userId,
        language: casesTable.language,
        sessionPhoneHash: sessionsTable.phoneNumberHash,
        sessionChannel: sessionsTable.channel,
      })
      .from(coalitionMembersTable)
      .innerJoin(casesTable, eq(coalitionMembersTable.caseId, casesTable.id))
      .leftJoin(sessionsTable, eq(sessionsTable.caseId, casesTable.id))
      .where(
        and(
          eq(coalitionMembersTable.coalitionId, id),
          eq(coalitionMembersTable.hasOptedIn, true),
        ),
      );

    // Collapse to one row per case (a case may have both voice and
    // whatsapp sessions; we surface the WhatsApp hash when present).
    const baseUrl =
      (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim() ?? "";
    const byCase = new Map<
      string,
      {
        caseId: string;
        userId: string | null;
        language: string;
        whatsappPhoneHash: string | null;
        inboxUrl: string;
      }
    >();
    for (const r of consentedRaw) {
      const existing = byCase.get(r.caseId);
      const wa =
        r.sessionChannel === "whatsapp" ? r.sessionPhoneHash : null;
      if (existing) {
        existing.whatsappPhoneHash = existing.whatsappPhoneHash ?? wa;
      } else {
        byCase.set(r.caseId, {
          caseId: r.caseId,
          userId: r.userId,
          language: r.language,
          whatsappPhoneHash: wa,
          inboxUrl: baseUrl
            ? `https://${baseUrl}/c/${r.caseId}/inbox`
            : `/c/${r.caseId}/inbox`,
        });
      }
    }
    const consented = Array.from(byCase.values());

    await db
      .update(coalitionsTable)
      .set({
        winningBidId: winningBid.id,
        finalizedAt: new Date(),
        status: "matched",
      })
      .where(eq(coalitionsTable.id, id));

    // Audit row per consenting member: this is the contact-release proof.
    if (consented.length > 0) {
      await db.insert(disclosuresTable).values(
        consented.map((m) => ({
          userId: m.userId,
          sessionId: m.caseId,
          version: "coalition-winner-release-v1",
        })),
      );
    }

    // Deliver the contact list through the controlled in-app
    // notifications channel — addressed to the winning lawyer's email,
    // not exposed in the HTTP response. The notifications.payload column
    // is server-side only and is read by an operator-side delivery job.
    await db.insert(notificationsTable).values({
      caseId: null,
      userId: null,
      kind: "coalition_update",
      channel: "email",
      payload: {
        to: winningBid.lawyerEmail,
        subject: `Coalition handoff (${id.slice(0, 8)})`,
        coalitionId: id,
        bidId: winningBid.id,
        contacts: consented,
        status: process.env.LEXOR_EMAIL_PROVIDER
          ? "queued"
          : "queued_no_provider",
      },
    });

    req.log.info(
      {
        coalitionId: id,
        winningBidId: winningBid.id,
        releasedCount: consented.length,
      },
      "coalition finalized; contact list queued for winning lawyer",
    );

    // Response is intentionally minimal — no PII, no contact list.
    res.json({
      ok: true,
      coalitionId: id,
      winningBidId: winningBid.id,
      lawyerName: winningBid.lawyerName,
      releasedCount: consented.length,
    });
  },
);

/**
 * GET /counsel/coalitions/by-case/:caseId
 * Used by the Coalition tab on the Case page to discover whether a case
 * belongs to any coalition.
 */
router.get(
  "/coalitions/by-case/:caseId",
  async (req: Request, res: Response) => {
    const caseId = String(req.params.caseId ?? "");
    assertUuid(caseId, "caseId");
    await assertCaseOwnership(req, caseId);
    const [row] = await db
      .select({
        coalitionId: coalitionMembersTable.coalitionId,
        hasOptedIn: coalitionMembersTable.hasOptedIn,
        status: coalitionsTable.status,
        entityName: entitiesTable.displayName,
        caseCount: coalitionsTable.caseCount,
      })
      .from(coalitionMembersTable)
      .innerJoin(
        coalitionsTable,
        eq(coalitionMembersTable.coalitionId, coalitionsTable.id),
      )
      .leftJoin(
        entitiesTable,
        eq(coalitionsTable.entityId, entitiesTable.id),
      )
      .where(eq(coalitionMembersTable.caseId, caseId))
      .limit(1);
    if (!row) {
      res.json({ coalition: null });
      return;
    }
    res.json({
      coalition: {
        id: row.coalitionId,
        hasOptedIn: row.hasOptedIn,
        status: row.status,
        entityName: row.entityName,
        caseCount: row.caseCount,
      },
    });
  },
);

/**
 * GET /counsel/coalitions/inbox/:caseId
 * The "in-app inbox" for a case — surfaces coalition_invite notifications
 * the fan-out generated. Unread count + items.
 */
router.get(
  "/coalitions/inbox/:caseId",
  async (req: Request, res: Response) => {
    const caseId = String(req.params.caseId ?? "");
    assertUuid(caseId, "caseId");
    await assertCaseOwnership(req, caseId);
    const items = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.caseId, caseId),
          eq(notificationsTable.channel, "inapp"),
        ),
      )
      .orderBy(desc(notificationsTable.sentAt))
      .limit(50);
    res.json({ items, unread: items.filter((i) => !i.readAt).length });
  },
);

/**
 * POST /counsel/coalitions/dev/seed
 * Dev-only acceptance fixture. Creates 6 synthetic eviction cases against a
 * fake landlord, all with very-similar embeddings, to exercise the auto-
 * formation path end-to-end. Refused in production.
 */
router.post("/coalitions/dev/seed", async (_req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    throw new HttpError(403, "forbidden", "Dev seed is disabled in production.");
  }

  // Upsert the fake landlord.
  const SEED_NAME = "lexor coalition fixture landlord";
  const [existing] = await db
    .select({ id: entitiesTable.id })
    .from(entitiesTable)
    .where(eq(entitiesTable.normalizedName, SEED_NAME))
    .limit(1);
  let entityId = existing?.id;
  if (!entityId) {
    const [ent] = await db
      .insert(entitiesTable)
      .values({
        normalizedName: SEED_NAME,
        displayName: "Coalition Fixture Landlord LLC",
        kind: "landlord",
        jurisdictions: ["US-CA"],
      })
      .returning({ id: entitiesTable.id });
    entityId = ent?.id;
  }
  if (!entityId) {
    throw new HttpError(500, "internal_error", "Could not seed entity.");
  }

  // Build a deterministic 1536-dim embedding that is near-identical across
  // all 6 cases (high cosine similarity), with tiny per-case noise.
  function syntheticEmbedding(seed: number): number[] {
    const v = new Array<number>(1536);
    for (let i = 0; i < 1536; i++) {
      v[i] = Math.sin(i * 0.01 + 1.0) + Math.sin(i * 0.001 + seed) * 0.001;
    }
    // L2 normalize so cosine = dot.
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm);
    return v.map((x) => x / norm);
  }

  const insertedIds: string[] = [];
  for (let i = 0; i < 6; i++) {
    const [row] = await db
      .insert(casesTable)
      .values({
        // Anonymous on purpose so the dev seed acceptance test can drive
        // the join/vote/finalize flow without a Clerk session.
        userId: null,
        status: "complete",
        vertical: "eviction",
        jurisdiction: "US-CA",
        rawDocumentUrl: `/text/${Buffer.from(`seed-letter-${i}`).toString("base64")}`,
        rawDocumentHash: `seed-hash-${i}`,
        adversaryEntityId: entityId,
        embedding: syntheticEmbedding(i),
        violations: [
          {
            code: "NO_JUST_CAUSE",
            statute: "Cal. Civ. Code § 1946.2",
            description:
              "Notice fails to state a just cause as required by California AB 1482.",
            severity: "high",
            agency: null,
          },
          {
            code: "INSUFFICIENT_NOTICE_PERIOD",
            statute: "Cal. Code Civ. P. § 1161",
            description: "Notice provides fewer days than statute requires.",
            severity: "medium",
            agency: null,
          },
        ],
      })
      .returning({ id: casesTable.id });
    if (row?.id) insertedIds.push(row.id);
  }

  // Trigger matching from the LAST inserted case — it sees the other 5 as
  // peers and auto-forms the coalition.
  const { matchOrFormCoalition } = await import("../../services/coalition/match");
  const result = await matchOrFormCoalition(insertedIds[insertedIds.length - 1]!);

  res.json({
    ok: true,
    entityId,
    seededCaseIds: insertedIds,
    match: result,
  });
});

export default router;
