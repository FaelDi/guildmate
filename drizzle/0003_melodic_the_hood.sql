CREATE TYPE "public"."join_policy" AS ENUM('OPEN', 'INVITE_ONLY');--> statement-breakpoint
CREATE TABLE "member_invite_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_lookup" text NOT NULL,
	"token_hint" text NOT NULL,
	"note" text,
	"created_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "join_policy" "join_policy" DEFAULT 'OPEN' NOT NULL;--> statement-breakpoint
ALTER TABLE "member_invite_redemptions" ADD CONSTRAINT "member_invite_redemptions_invite_id_member_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."member_invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_invite_redemptions" ADD CONSTRAINT "member_invite_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_invites" ADD CONSTRAINT "member_invites_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_invites" ADD CONSTRAINT "member_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_invite_redemptions_key" ON "member_invite_redemptions" USING btree ("invite_id","user_id");--> statement-breakpoint
CREATE INDEX "member_invite_redemptions_user_idx" ON "member_invite_redemptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_invites_token_lookup_key" ON "member_invites" USING btree ("token_lookup");--> statement-breakpoint
CREATE INDEX "member_invites_guild_idx" ON "member_invites" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "member_invites_expires_idx" ON "member_invites" USING btree ("expires_at");