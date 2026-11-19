CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"alt" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"focus" smallint DEFAULT 4 NOT NULL,
	"treatment" text DEFAULT 'mood' NOT NULL,
	"rights_confirmed" boolean DEFAULT false NOT NULL,
	"rights_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "images_url_https" CHECK ("images"."url" ~ '^https://'),
	CONSTRAINT "images_alt_length" CHECK (char_length("images"."alt") between 1 and 300),
	CONSTRAINT "images_size_positive" CHECK ("images"."width" > 0 and "images"."height" > 0),
	CONSTRAINT "images_focus_range" CHECK ("images"."focus" between 0 and 8),
	CONSTRAINT "images_treatment" CHECK ("images"."treatment" in ('mood', 'original')),
	CONSTRAINT "images_rights_note_length" CHECK (char_length("images"."rights_note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "mixtape_tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mixtape_id" uuid NOT NULL,
	"song_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"note_side" text DEFAULT 'right' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mixtape_tracks_position_positive" CHECK ("mixtape_tracks"."position" > 0),
	CONSTRAINT "mixtape_tracks_note_length" CHECK (char_length("mixtape_tracks"."note") <= 1000),
	CONSTRAINT "mixtape_tracks_note_side" CHECK ("mixtape_tracks"."note_side" in ('left', 'right'))
);
--> statement-breakpoint
CREATE TABLE "mixtapes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" smallint NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"theme" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reflection" text DEFAULT '' NOT NULL,
	"pull_quote" text DEFAULT '' NOT NULL,
	"pull_quote_credit" text DEFAULT '' NOT NULL,
	"playlist_url" text,
	"year" smallint,
	"cover_image_id" uuid,
	"detail_image_id" uuid,
	"detail_caption" text DEFAULT '' NOT NULL,
	"featured_rank" smallint,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mixtapes_number_range" CHECK ("mixtapes"."number" between 1 and 999),
	CONSTRAINT "mixtapes_slug_format" CHECK ("mixtapes"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("mixtapes"."slug") <= 80),
	CONSTRAINT "mixtapes_title_length" CHECK (char_length("mixtapes"."title") between 1 and 120),
	CONSTRAINT "mixtapes_theme_length" CHECK (char_length("mixtapes"."theme") <= 120),
	CONSTRAINT "mixtapes_description_length" CHECK (char_length("mixtapes"."description") <= 600),
	CONSTRAINT "mixtapes_reflection_length" CHECK (char_length("mixtapes"."reflection") <= 20000),
	CONSTRAINT "mixtapes_pull_quote_length" CHECK (char_length("mixtapes"."pull_quote") <= 600 and char_length("mixtapes"."pull_quote_credit") <= 200),
	CONSTRAINT "mixtapes_playlist_url_https" CHECK ("mixtapes"."playlist_url" is null or ("mixtapes"."playlist_url" ~ '^https://' and char_length("mixtapes"."playlist_url") <= 500)),
	CONSTRAINT "mixtapes_year_range" CHECK ("mixtapes"."year" is null or "mixtapes"."year" between 1900 and 2100),
	CONSTRAINT "mixtapes_detail_caption_length" CHECK (char_length("mixtapes"."detail_caption") <= 200),
	CONSTRAINT "mixtapes_featured_rank_range" CHECK ("mixtapes"."featured_rank" is null or "mixtapes"."featured_rank" between 1 and 3),
	CONSTRAINT "mixtapes_status" CHECK ("mixtapes"."status" in ('draft', 'published')),
	CONSTRAINT "mixtapes_published_at" CHECK (("mixtapes"."status" = 'published') = ("mixtapes"."published_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "site_images" (
	"slot" text PRIMARY KEY NOT NULL,
	"image_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_images_slot_format" CHECK ("site_images"."slot" ~ '^[a-z0-9]+(\.[a-z0-9_]+)+$')
);
--> statement-breakpoint
CREATE TABLE "site_texts" (
	"key" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_texts_key_format" CHECK ("site_texts"."key" ~ '^[a-z0-9]+(\.[a-z0-9_]+)+$'),
	CONSTRAINT "site_texts_body_length" CHECK (char_length("site_texts"."body") <= 20000)
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"artist" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "songs_title_length" CHECK (char_length(btrim("songs"."title")) between 1 and 200),
	CONSTRAINT "songs_artist_length" CHECK (char_length(btrim("songs"."artist")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "mixtape_tracks" ADD CONSTRAINT "mixtape_tracks_mixtape_id_mixtapes_id_fk" FOREIGN KEY ("mixtape_id") REFERENCES "public"."mixtapes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixtape_tracks" ADD CONSTRAINT "mixtape_tracks_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixtapes" ADD CONSTRAINT "mixtapes_cover_image_id_images_id_fk" FOREIGN KEY ("cover_image_id") REFERENCES "public"."images"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixtapes" ADD CONSTRAINT "mixtapes_detail_image_id_images_id_fk" FOREIGN KEY ("detail_image_id") REFERENCES "public"."images"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_images" ADD CONSTRAINT "site_images_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "images_url_key" ON "images" USING btree ("url");--> statement-breakpoint
CREATE UNIQUE INDEX "mixtape_tracks_position_key" ON "mixtape_tracks" USING btree ("mixtape_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "mixtape_tracks_song_key" ON "mixtape_tracks" USING btree ("mixtape_id","song_id");--> statement-breakpoint
CREATE INDEX "mixtape_tracks_song_idx" ON "mixtape_tracks" USING btree ("song_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mixtapes_number_key" ON "mixtapes" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "mixtapes_slug_key" ON "mixtapes" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "mixtapes_featured_rank_key" ON "mixtapes" USING btree ("featured_rank");--> statement-breakpoint
CREATE UNIQUE INDEX "songs_title_artist_key" ON "songs" USING btree (lower("title"),lower("artist"));--> statement-breakpoint
CREATE INDEX "songs_artist_idx" ON "songs" USING btree ("artist");