DROP TABLE "auction_bids" CASCADE;--> statement-breakpoint
DROP TABLE "auctions" CASCADE;--> statement-breakpoint
DROP TABLE "market_listings" CASCADE;--> statement-breakpoint
ALTER TABLE "guild_settings" DROP COLUMN "auction_anti_snipe_seconds";--> statement-breakpoint
ALTER TABLE "public"."point_ledger" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."ledger_kind";--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('EVENT_AWARD', 'EVENT_ADJUSTMENT', 'EVENT_REVERSAL', 'ADMIN_ADJUSTMENT');--> statement-breakpoint
ALTER TABLE "public"."point_ledger" ALTER COLUMN "kind" SET DATA TYPE "public"."ledger_kind" USING "kind"::"public"."ledger_kind";--> statement-breakpoint
ALTER TABLE "public"."user_restrictions" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."restriction_type";--> statement-breakpoint
CREATE TYPE "public"."restriction_type" AS ENUM('BAN', 'SUSPENSION', 'NO_EVENTS');--> statement-breakpoint
ALTER TABLE "public"."user_restrictions" ALTER COLUMN "type" SET DATA TYPE "public"."restriction_type" USING "type"::"public"."restriction_type";--> statement-breakpoint
DROP TYPE "public"."auction_status";--> statement-breakpoint
DROP TYPE "public"."item_rarity";--> statement-breakpoint
DROP TYPE "public"."item_type";--> statement-breakpoint
DROP TYPE "public"."listing_status";