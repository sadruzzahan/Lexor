ALTER TABLE "courtroom_sessions"
  ALTER COLUMN "consent_transcript" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "courtroom_sessions"
  ALTER COLUMN "consent_transcript" SET DATA TYPE boolean
  USING (
    CASE
      WHEN "consent_transcript" IS NULL THEN false
      WHEN "consent_transcript"::text IN ('true', '"true"') THEN true
      ELSE false
    END
  );--> statement-breakpoint
ALTER TABLE "courtroom_sessions"
  ALTER COLUMN "consent_transcript" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "courtroom_sessions"
  ALTER COLUMN "consent_transcript" SET NOT NULL;
