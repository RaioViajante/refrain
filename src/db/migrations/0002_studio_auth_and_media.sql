CREATE TABLE "studio_login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_key" text NOT NULL,
	"succeeded" boolean NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_login_attempts_client_key_format" CHECK ("studio_login_attempts"."client_key" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "studio_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studio_sessions_token_hash_format" CHECK ("studio_sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "studio_sessions_expiry" CHECK ("studio_sessions"."expires_at" > "studio_sessions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "images" DROP CONSTRAINT "images_url_https";--> statement-breakpoint
ALTER TABLE "mixtapes" DROP CONSTRAINT "mixtapes_number_range";--> statement-breakpoint
CREATE INDEX "studio_login_attempts_client_idx" ON "studio_login_attempts" USING btree ("client_key","attempted_at");--> statement-breakpoint
CREATE INDEX "studio_login_attempts_at_idx" ON "studio_login_attempts" USING btree ("attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "studio_sessions_token_hash_key" ON "studio_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "studio_sessions_expires_at_idx" ON "studio_sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_url_source" CHECK ("images"."url" ~ '^https://' or "images"."url" ~ '^/media/[a-z0-9-]+\.(jpg|png)$');--> statement-breakpoint
ALTER TABLE "mixtapes" ADD CONSTRAINT "mixtapes_number_positive" CHECK ("mixtapes"."number" > 0);