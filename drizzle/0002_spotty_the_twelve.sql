ALTER TABLE "guild_settings" ALTER COLUMN "default_code_ttl_minutes" SET DEFAULT 60;--> statement-breakpoint
-- Guilds still carrying the old default never chose 30 minutes; they inherited
-- it. Moving them is what makes the new default take effect for real. A guild
-- that picked any other lifetime is left exactly as it is.
UPDATE "guild_settings" SET "default_code_ttl_minutes" = 60 WHERE "default_code_ttl_minutes" = 30;