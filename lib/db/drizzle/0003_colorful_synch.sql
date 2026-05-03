CREATE TYPE "public"."trial_character" AS ENUM('opposing', 'judge', 'your_counsel');--> statement-breakpoint
CREATE TYPE "public"."trial_outcome" AS ENUM('plaintiff', 'defendant', 'mixed', 'undetermined');--> statement-breakpoint
CREATE TYPE "public"."trial_status" AS ENUM('queued', 'running', 'complete', 'failed');--> statement-breakpoint
CREATE TABLE "trial_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id" uuid NOT NULL,
	"ord" integer NOT NULL,
	"character" "trial_character" NOT NULL,
	"line" text NOT NULL,
	"citation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"status" "trial_status" DEFAULT 'queued' NOT NULL,
	"predicted_outcome" "trial_outcome",
	"predicted_rationale" text,
	"swing_arguments" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "trial_turns" ADD CONSTRAINT "trial_turns_trial_id_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."trials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trials" ADD CONSTRAINT "trials_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trial_turns_trial_id_idx" ON "trial_turns" USING btree ("trial_id");--> statement-breakpoint
CREATE INDEX "trials_case_id_idx" ON "trials" USING btree ("case_id");