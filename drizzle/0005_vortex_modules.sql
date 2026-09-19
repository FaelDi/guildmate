CREATE TYPE "public"."boss_respawn_kind" AS ENUM('INTERVAL', 'DAILY', 'WEEKLY');--> statement-breakpoint
CREATE TYPE "public"."loot_banner_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."loot_bet_status" AS ENUM('ACTIVE', 'WON', 'RELEASED');--> statement-breakpoint
CREATE TYPE "public"."loot_item_status" AS ENUM('OPEN', 'DRAWN', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."loot_restriction" AS ENUM('ALL', 'TITAN', 'MEGA');--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'LOOT_HOLD';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'LOOT_RELEASE';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'PENALTY';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'PENALTY_REVERSAL';--> statement-breakpoint
ALTER TYPE "public"."restriction_type" ADD VALUE 'NO_LOOT';--> statement-breakpoint
CREATE TABLE "attendance_excuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"week_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"events_excused" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "boss_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"name" text NOT NULL,
	"respawn_kind" "boss_respawn_kind" NOT NULL,
	"interval_hours" integer,
	"anchor_at" timestamp with time zone,
	"daily_times" text,
	"weekdays" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bosses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"group_id" uuid,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"respawn_kind" "boss_respawn_kind",
	"interval_hours" integer,
	"anchor_at" timestamp with time zone,
	"daily_times" text,
	"weekdays" text,
	"in_rotation" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "loot_banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"title" text NOT NULL,
	"closes_at" timestamp with time zone,
	"status" "loot_banner_status" DEFAULT 'OPEN' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loot_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"guild_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"hold_ledger_id" uuid NOT NULL,
	"status" "loot_bet_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "loot_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"banner_id" uuid NOT NULL,
	"guild_id" uuid NOT NULL,
	"name" text NOT NULL,
	"max_points" integer NOT NULL,
	"restriction" "loot_restriction" DEFAULT 'ALL' NOT NULL,
	"status" "loot_item_status" DEFAULT 'OPEN' NOT NULL,
	"winner_user_id" uuid,
	"winner_character_id" uuid,
	"winner_name" text,
	"staff_name" text,
	"points_paid" integer DEFAULT 0 NOT NULL,
	"draw_slices" jsonb,
	"drawn_at" timestamp with time zone,
	"drawn_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meme_draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"winner_character_id" uuid,
	"winner_name" text NOT NULL,
	"candidate_count" integer NOT NULL,
	"note" text,
	"drawn_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "combat_power" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "skill_4" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "skill_5" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "skill_6" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "skill_7" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "constant_3" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "pain_adaptation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "trinity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "technique_master" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "mega_cp_threshold" integer DEFAULT 190000 NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "titan_cp_threshold" integer DEFAULT 155000 NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "loot_min_participation_pct" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "loot_staff_share_pct" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_excuses" ADD CONSTRAINT "attendance_excuses_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_excuses" ADD CONSTRAINT "attendance_excuses_week_id_guild_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."guild_weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_excuses" ADD CONSTRAINT "attendance_excuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_excuses" ADD CONSTRAINT "attendance_excuses_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boss_groups" ADD CONSTRAINT "boss_groups_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bosses" ADD CONSTRAINT "bosses_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bosses" ADD CONSTRAINT "bosses_group_id_boss_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."boss_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_weeks" ADD CONSTRAINT "guild_weeks_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_weeks" ADD CONSTRAINT "guild_weeks_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_banners" ADD CONSTRAINT "loot_banners_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_banners" ADD CONSTRAINT "loot_banners_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_bets" ADD CONSTRAINT "loot_bets_item_id_loot_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."loot_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_bets" ADD CONSTRAINT "loot_bets_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_bets" ADD CONSTRAINT "loot_bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_bets" ADD CONSTRAINT "loot_bets_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_items" ADD CONSTRAINT "loot_items_banner_id_loot_banners_id_fk" FOREIGN KEY ("banner_id") REFERENCES "public"."loot_banners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_items" ADD CONSTRAINT "loot_items_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_items" ADD CONSTRAINT "loot_items_winner_user_id_users_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_items" ADD CONSTRAINT "loot_items_winner_character_id_characters_id_fk" FOREIGN KEY ("winner_character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loot_items" ADD CONSTRAINT "loot_items_drawn_by_user_id_users_id_fk" FOREIGN KEY ("drawn_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meme_draws" ADD CONSTRAINT "meme_draws_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meme_draws" ADD CONSTRAINT "meme_draws_winner_character_id_characters_id_fk" FOREIGN KEY ("winner_character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meme_draws" ADD CONSTRAINT "meme_draws_drawn_by_user_id_users_id_fk" FOREIGN KEY ("drawn_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_excuses_week_user_idx" ON "attendance_excuses" USING btree ("week_id","user_id");--> statement-breakpoint
CREATE INDEX "boss_groups_guild_idx" ON "boss_groups" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "bosses_guild_idx" ON "bosses" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "bosses_group_idx" ON "bosses" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guild_weeks_guild_number_key" ON "guild_weeks" USING btree ("guild_id","number");--> statement-breakpoint
CREATE INDEX "guild_weeks_guild_started_idx" ON "guild_weeks" USING btree ("guild_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "loot_banners_one_open_per_guild" ON "loot_banners" USING btree ("guild_id") WHERE "loot_banners"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "loot_banners_guild_created_idx" ON "loot_banners" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "loot_bets_one_active_per_user" ON "loot_bets" USING btree ("item_id","user_id") WHERE "loot_bets"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "loot_bets_item_idx" ON "loot_bets" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "loot_bets_user_idx" ON "loot_bets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "loot_items_banner_idx" ON "loot_items" USING btree ("banner_id");--> statement-breakpoint
CREATE INDEX "loot_items_guild_drawn_idx" ON "loot_items" USING btree ("guild_id","drawn_at");--> statement-breakpoint
CREATE INDEX "meme_draws_guild_created_idx" ON "meme_draws" USING btree ("guild_id","created_at");