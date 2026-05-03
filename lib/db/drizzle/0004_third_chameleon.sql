CREATE TYPE "public"."inbox_alert_category" AS ENUM('eviction', 'court_summons', 'debt', 'irs', 'ice', 'employment');--> statement-breakpoint
CREATE TYPE "public"."inbox_alert_status" AS ENUM('fired', 'dispatched', 'reviewed', 'sent', 'dismissed', 'failed');--> statement-breakpoint
CREATE TABLE "gmail_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"gmail_email" text,
	"phone_number" text,
	"last_history_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_watches_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "inbox_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"case_id" uuid,
	"category" "inbox_alert_category" NOT NULL,
	"status" "inbox_alert_status" DEFAULT 'fired' NOT NULL,
	"sender_display" text NOT NULL,
	"subject" text NOT NULL,
	"gist" text NOT NULL,
	"deadline_iso" text,
	"drafted_reply" text,
	"gmail_message_id" text,
	"gmail_thread_id" text,
	"call_sid" text,
	"confidence" text,
	"meta" jsonb,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "gmail_watches_user_id_idx" ON "gmail_watches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inbox_alerts_user_id_idx" ON "inbox_alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inbox_alerts_case_id_idx" ON "inbox_alerts" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "inbox_alerts_status_idx" ON "inbox_alerts" USING btree ("status");