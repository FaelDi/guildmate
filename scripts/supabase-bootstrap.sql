-- GuildMate bootstrap: run once in the Supabase SQL Editor.
--
-- For a machine that can reach the database directly, `npm run db:migrate`
-- plus `npm run db:seed` is the normal path and stays authoritative. This file
-- exists for the case where only the dashboard is available.
--
-- Section 1 is drizzle/0000_init.sql verbatim (the schema).
-- Section 2 is the biosuit catalogue, the same rows npm run db:seed inserts.
-- Section 3 records the migration as applied, so a later npm run db:migrate
-- does not try to create everything a second time.
--
-- Re-running is safe only for sections 2 and 3; section 1 fails the second
-- time because the types already exist. That is intended: a schema that is
-- already there must not be silently reapplied.
--
-- WARNING: section 1 is a COPY of drizzle/0000_init.sql, frozen at the initial
-- migration. It does NOT pick up later migrations. Once drizzle/ has a 0001,
-- this file only bootstraps a database to the 0000 state - apply the rest with
-- `npm run db:migrate`, or regenerate this file.

BEGIN;

-- ===========================================================================
-- 1. Schema
-- ===========================================================================

CREATE TYPE "public"."alt_points_policy" AS ENUM('CREDIT_MAIN', 'NO_CREDIT');--> statement-breakpoint
CREATE TYPE "public"."auction_status" AS ENUM('DRAFT', 'OPEN', 'CLOSED', 'SETTLED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."character_kind" AS ENUM('MAIN', 'ALT');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('OPEN', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."item_rarity" AS ENUM('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY');--> statement-breakpoint
CREATE TYPE "public"."item_type" AS ENUM('WEAPON', 'ARMOR', 'SHIELD', 'HELMET', 'GLOVES', 'BOOTS', 'ACCESSORY', 'BIOSUIT', 'MATERIAL', 'CONSUMABLE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('EVENT_AWARD', 'EVENT_ADJUSTMENT', 'EVENT_REVERSAL', 'ADMIN_ADJUSTMENT', 'AUCTION_HOLD', 'AUCTION_RELEASE');--> statement-breakpoint
CREATE TYPE "public"."ledger_state" AS ENUM('PENDING', 'CONFIRMED', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('ACTIVE', 'RESERVED', 'SOLD', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."race" AS ENUM('BELLATO', 'CORA', 'ACCRETIA');--> statement-breakpoint
CREATE TYPE "public"."registration_source" AS ENUM('SELF_CODE', 'ADMIN_GRANT');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('PENDING', 'CONFIRMED', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."restriction_type" AS ENUM('BAN', 'SUSPENSION', 'NO_EVENTS', 'NO_AUCTION', 'NO_MARKET');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('MEMBER', 'VICE_LEADER', 'LEADER', 'SUPER_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'INACTIVE', 'BANNED', 'DELETED');--> statement-breakpoint
CREATE TABLE "auction_bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auction_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"hold_ledger_id" uuid,
	"is_winning" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"description" text,
	"item_type" "item_type" DEFAULT 'OTHER' NOT NULL,
	"rarity" "item_rarity" DEFAULT 'RARE' NOT NULL,
	"item_level" integer DEFAULT 1 NOT NULL,
	"starting_bid" integer NOT NULL,
	"min_increment" integer DEFAULT 1 NOT NULL,
	"current_bid" integer,
	"current_bidder_user_id" uuid,
	"current_bidder_character_id" uuid,
	"status" "auction_status" DEFAULT 'DRAFT' NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biosuits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race" "race" NOT NULL,
	"name" text NOT NULL,
	"min_level" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"guild_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"race" "race" NOT NULL,
	"biosuit" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"kind" character_kind DEFAULT 'MAIN' NOT NULL,
	"main_character_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"status" "registration_status" DEFAULT 'PENDING' NOT NULL,
	"source" "registration_source" DEFAULT 'SELF_CODE' NOT NULL,
	"granted_by_user_id" uuid,
	"level_at_registration" integer NOT NULL,
	"ip_hash" text,
	"user_agent_hash" text,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"points_value" integer NOT NULL,
	"status" "event_status" DEFAULT 'OPEN' NOT NULL,
	"code_hash" text NOT NULL,
	"code_lookup" text NOT NULL,
	"code_hint" text NOT NULL,
	"code_rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registration_closes_at" timestamp with time zone NOT NULL,
	"confirmation_deadline" timestamp with time zone NOT NULL,
	"min_participants" integer DEFAULT 3 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_settings" (
	"guild_id" uuid PRIMARY KEY NOT NULL,
	"min_participants" integer DEFAULT 3 NOT NULL,
	"confirmation_window_hours" integer DEFAULT 48 NOT NULL,
	"default_code_ttl_minutes" integer DEFAULT 30 NOT NULL,
	"max_code_ttl_minutes" integer DEFAULT 720 NOT NULL,
	"max_registrations_per_day" integer DEFAULT 12 NOT NULL,
	"min_level_to_register" integer DEFAULT 1 NOT NULL,
	"alt_points_policy" "alt_points_policy" DEFAULT 'CREDIT_MAIN' NOT NULL,
	"admin_grant_approval_threshold" integer DEFAULT 500 NOT NULL,
	"auction_anti_snipe_seconds" integer DEFAULT 120 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"tag" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"seller_user_id" uuid NOT NULL,
	"seller_character_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"item_type" "item_type" DEFAULT 'OTHER' NOT NULL,
	"rarity" "item_rarity" DEFAULT 'COMMON' NOT NULL,
	"item_level" integer DEFAULT 1 NOT NULL,
	"price_diamonds" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"status" "listing_status" DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone,
	"sold_at" timestamp with time zone,
	"sold_to_character_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "point_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid,
	"kind" "ledger_kind" NOT NULL,
	"state" "ledger_state" DEFAULT 'PENDING' NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"event_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state_changed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_restrictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "restriction_type" NOT NULL,
	"reason" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"email" text NOT NULL,
	"supabase_user_id" uuid NOT NULL,
	"role" "user_role" DEFAULT 'MEMBER' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD CONSTRAINT "guild_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_seller_user_id_users_id_fk" FOREIGN KEY ("seller_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_seller_character_id_characters_id_fk" FOREIGN KEY ("seller_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_restrictions" ADD CONSTRAINT "user_restrictions_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_restrictions" ADD CONSTRAINT "user_restrictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_restrictions" ADD CONSTRAINT "user_restrictions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auction_bids_auction_idx" ON "auction_bids" USING btree ("auction_id","amount");--> statement-breakpoint
CREATE INDEX "auction_bids_user_idx" ON "auction_bids" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auctions_guild_status_idx" ON "auctions" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "auctions_ends_at_idx" ON "auctions" USING btree ("ends_at");--> statement-breakpoint
CREATE INDEX "audit_log_guild_created_idx" ON "audit_log" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "biosuits_race_name_key" ON "biosuits" USING btree ("race","name");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_guild_name_key" ON "characters" USING btree ("guild_id","name_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_one_main_per_user" ON "characters" USING btree ("user_id") WHERE "characters"."kind" = 'MAIN';--> statement-breakpoint
CREATE INDEX "characters_user_idx" ON "characters" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "characters_guild_idx" ON "characters" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_registrations_event_user_key" ON "event_registrations" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_registrations_event_character_key" ON "event_registrations" USING btree ("event_id","character_id");--> statement-breakpoint
CREATE INDEX "event_registrations_user_idx" ON "event_registrations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "event_registrations_event_idx" ON "event_registrations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_guild_status_idx" ON "events" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "events_code_lookup_idx" ON "events" USING btree ("code_lookup");--> statement-breakpoint
CREATE INDEX "events_registration_closes_idx" ON "events" USING btree ("registration_closes_at");--> statement-breakpoint
CREATE INDEX "events_confirmation_deadline_idx" ON "events" USING btree ("confirmation_deadline");--> statement-breakpoint
CREATE UNIQUE INDEX "guilds_slug_key" ON "guilds" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "market_listings_guild_status_idx" ON "market_listings" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "market_listings_seller_idx" ON "market_listings" USING btree ("seller_user_id");--> statement-breakpoint
CREATE INDEX "market_listings_expires_idx" ON "market_listings" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "point_ledger_user_state_idx" ON "point_ledger" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "point_ledger_event_idx" ON "point_ledger" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "point_ledger_ref_idx" ON "point_ledger" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "user_restrictions_user_idx" ON "user_restrictions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_restrictions_active_idx" ON "user_restrictions" USING btree ("user_id","type","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_supabase_user_id_key" ON "users" USING btree ("supabase_user_id");--> statement-breakpoint
CREATE INDEX "users_guild_idx" ON "users" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");

-- ===========================================================================
-- 2. Biosuit catalogue
-- ===========================================================================

INSERT INTO "biosuits" ("race", "name", "min_level") VALUES
  ('BELLATO', 'Arbiter', 1),
  ('BELLATO', 'Demolisher', 1),
  ('BELLATO', 'Dreadnought', 1),
  ('BELLATO', 'Enforcer', 1),
  ('BELLATO', 'Phantom', 1),
  ('BELLATO', 'Psypher', 1),
  ('BELLATO', 'Punisher', 1),
  ('BELLATO', 'Technician', 1),
  ('CORA', 'Arbiter', 1),
  ('CORA', 'Demolisher', 1),
  ('CORA', 'Dreadnought', 1),
  ('CORA', 'Enforcer', 1),
  ('CORA', 'Phantom', 1),
  ('CORA', 'Psypher', 1),
  ('CORA', 'Punisher', 1),
  ('CORA', 'Technician', 1),
  ('ACCRETIA', 'Arbiter', 1),
  ('ACCRETIA', 'Demolisher', 1),
  ('ACCRETIA', 'Dreadnought', 1),
  ('ACCRETIA', 'Enforcer', 1),
  ('ACCRETIA', 'Phantom', 1),
  ('ACCRETIA', 'Psypher', 1),
  ('ACCRETIA', 'Punisher', 1),
  ('ACCRETIA', 'Technician', 1)
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 3. Mark drizzle/0000_init as applied
-- ===========================================================================

CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ('7dc05c1f8796693b6ad8980361ac6f66333935b29d4ee15d2ff42a9794ae2791', 1786290112764);

COMMIT;
