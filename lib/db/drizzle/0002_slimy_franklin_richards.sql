CREATE TYPE "public"."notification_channel" AS ENUM('inapp', 'email', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('coalition_invite', 'coalition_update');--> statement-breakpoint
CREATE TABLE "coalition_votes" (
	"coalition_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"bid_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coalition_votes_coalition_id_case_id_pk" PRIMARY KEY("coalition_id","case_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid,
	"user_id" text,
	"kind" "notification_kind" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"payload" jsonb NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "coalitions" ADD COLUMN "winning_bid_id" uuid;--> statement-breakpoint
ALTER TABLE "coalitions" ADD COLUMN "finalized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coalition_votes" ADD CONSTRAINT "coalition_votes_coalition_id_coalitions_id_fk" FOREIGN KEY ("coalition_id") REFERENCES "public"."coalitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coalition_votes" ADD CONSTRAINT "coalition_votes_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coalition_votes" ADD CONSTRAINT "coalition_votes_bid_id_lawyer_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."lawyer_bids"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coalition_votes_bid_idx" ON "coalition_votes" USING btree ("bid_id");--> statement-breakpoint
CREATE INDEX "notifications_case_idx" ON "notifications" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");