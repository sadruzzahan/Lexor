CREATE TABLE "planner_skip_history" (
	"case_id" uuid NOT NULL,
	"subagent" text NOT NULL,
	"empty_count" integer DEFAULT 0 NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replay_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"replay_case_id" uuid NOT NULL,
	"run_id" uuid,
	"passed" boolean NOT NULL,
	"diff" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "agent_messages_run_idx";--> statement-breakpoint
DROP INDEX "prompt_versions_key_version_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX "planner_skip_history_pk" ON "planner_skip_history" USING btree ("case_id","subagent");--> statement-breakpoint
CREATE INDEX "replay_runs_case_idx" ON "replay_runs" USING btree ("replay_case_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_messages_run_idx_uniq" ON "agent_messages" USING btree ("run_id","idx");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_key_version_variant_uniq" ON "prompt_versions" USING btree ("prompt_key","version","variant");