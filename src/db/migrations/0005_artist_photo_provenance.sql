ALTER TABLE "artists" ADD COLUMN "photo_file_sha1" text;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "photo_file_timestamp" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "photo_chosen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_photo_file_sha1_check" CHECK (photo_file_sha1 ~ '^[0-9a-f]{40}$');--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_photo_provenance_check" CHECK ((photo_url is null) = (photo_file_sha1 is null) and (photo_url is null) = (photo_file_timestamp is null) and (photo_url is null) = (photo_chosen_at is null));