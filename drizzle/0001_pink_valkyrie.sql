CREATE TABLE "guild_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"token_lookup" text NOT NULL,
	"token_hint" text NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_by_user_id" uuid,
	"guild_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_invites" ADD CONSTRAINT "guild_invites_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_invites" ADD CONSTRAINT "guild_invites_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_invites" ADD CONSTRAINT "guild_invites_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guild_invites" ADD CONSTRAINT "guild_invites_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guild_invites_token_lookup_key" ON "guild_invites" USING btree ("token_lookup");--> statement-breakpoint
CREATE INDEX "guild_invites_expires_idx" ON "guild_invites" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "guild_invites_redeemed_idx" ON "guild_invites" USING btree ("redeemed_at");