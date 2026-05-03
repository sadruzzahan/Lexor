CREATE TYPE "public"."case_status" AS ENUM('queued', 'parsing', 'analyzing', 'drafting', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."case_vertical" AS ENUM('eviction', 'debt', 'wage', 'other');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('landlord', 'employer', 'debt_collector', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."coalition_status" AS ENUM('forming', 'open', 'matched', 'closed');--> statement-breakpoint
CREATE TYPE "public"."session_channel" AS ENUM('voice', 'whatsapp');--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"status" "case_status" DEFAULT 'queued' NOT NULL,
	"vertical" "case_vertical" DEFAULT 'other' NOT NULL,
	"jurisdiction" text,
	"language" text DEFAULT 'en' NOT NULL,
	"raw_document_url" text,
	"raw_document_hash" text,
	"parsed" jsonb,
	"violations" jsonb,
	"response_letter" jsonb,
	"regulator_complaints" jsonb,
	"adversary_entity_id" uuid,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_name" text NOT NULL,
	"display_name" text NOT NULL,
	"kind" "entity_kind" DEFAULT 'unknown' NOT NULL,
	"jurisdictions" text[] DEFAULT '{}' NOT NULL,
	"registration_data" jsonb,
	"litigation_stats" jsonb,
	"alternate_names" text[] DEFAULT '{}' NOT NULL,
	"pin_count" integer DEFAULT 0 NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_markers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"case_vertical" "case_vertical" NOT NULL,
	"violation_codes" text[] DEFAULT '{}' NOT NULL,
	"coarse_lat" numeric(8, 4) NOT NULL,
	"coarse_lng" numeric(9, 4) NOT NULL,
	"zip_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coalitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"vertical" "case_vertical" NOT NULL,
	"jurisdiction" text,
	"letter_template_hash" text,
	"case_count" integer DEFAULT 0 NOT NULL,
	"status" "coalition_status" DEFAULT 'forming' NOT NULL,
	"class_complaint_draft_html" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coalition_members" (
	"coalition_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"has_opted_in" boolean DEFAULT false NOT NULL,
	CONSTRAINT "coalition_members_coalition_id_case_id_pk" PRIMARY KEY("coalition_id","case_id")
);
--> statement-breakpoint
CREATE TABLE "lawyer_bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coalition_id" uuid NOT NULL,
	"lawyer_name" text NOT NULL,
	"lawyer_bar_number" text NOT NULL,
	"lawyer_email" text NOT NULL,
	"lawyer_firm" text,
	"contingency_percent" numeric(5, 2) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" "session_channel" NOT NULL,
	"external_id" text,
	"phone_number_hash" text,
	"language" text DEFAULT 'en' NOT NULL,
	"case_id" uuid,
	"transcript_jsonl" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "disclosures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"session_id" text,
	"version" text NOT NULL,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_adversary_entity_id_entities_id_fk" FOREIGN KEY ("adversary_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_markers" ADD CONSTRAINT "map_markers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coalitions" ADD CONSTRAINT "coalitions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coalition_members" ADD CONSTRAINT "coalition_members_coalition_id_coalitions_id_fk" FOREIGN KEY ("coalition_id") REFERENCES "public"."coalitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coalition_members" ADD CONSTRAINT "coalition_members_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lawyer_bids" ADD CONSTRAINT "lawyer_bids_coalition_id_coalitions_id_fk" FOREIGN KEY ("coalition_id") REFERENCES "public"."coalitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_raw_document_hash_idx" ON "cases" USING btree ("raw_document_hash");--> statement-breakpoint
CREATE INDEX "cases_user_id_idx" ON "cases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cases_adversary_entity_id_idx" ON "cases" USING btree ("adversary_entity_id");--> statement-breakpoint
CREATE INDEX "cases_embedding_ivfflat_cosine_idx" ON "cases" USING ivfflat (embedding vector_cosine_ops) WITH (lists=100);--> statement-breakpoint
CREATE UNIQUE INDEX "entities_normalized_name_uq" ON "entities" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "map_markers_zip_code_idx" ON "map_markers" USING btree ("zip_code");--> statement-breakpoint
CREATE INDEX "map_markers_entity_id_idx" ON "map_markers" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "coalitions_entity_id_idx" ON "coalitions" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "lawyer_bids_coalition_id_idx" ON "lawyer_bids" USING btree ("coalition_id");--> statement-breakpoint
CREATE INDEX "sessions_external_id_idx" ON "sessions" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "disclosures_user_id_idx" ON "disclosures" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "disclosures_session_id_idx" ON "disclosures" USING btree ("session_id");