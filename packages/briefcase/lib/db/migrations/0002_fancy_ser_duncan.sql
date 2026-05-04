ALTER TABLE "courtroom_sessions" ALTER COLUMN "started_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "courtroom_sessions" ALTER COLUMN "started_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "courtroom_sessions" ADD COLUMN "jurisdiction_country" text DEFAULT 'US' NOT NULL;--> statement-breakpoint
ALTER TABLE "courtroom_sessions" ADD COLUMN "consent_transcript" jsonb DEFAULT 'false'::jsonb;--> statement-breakpoint
ALTER TABLE "courtroom_sessions" ADD COLUMN "transport" text DEFAULT 'http_chunks' NOT NULL;