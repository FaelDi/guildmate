ALTER TYPE "public"."user_status" ADD VALUE 'PENDING' BEFORE 'ACTIVE';--> statement-breakpoint
ALTER TABLE "member_invites" ADD COLUMN "grants_role" "user_role" DEFAULT 'MEMBER' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
-- Accounts that predate the approval gate were already members: approving
-- them retroactively is what keeps this migration from locking out the guild.
UPDATE "users" SET "approved_at" = "created_at" WHERE "approved_at" IS NULL AND "deleted_at" IS NULL;
