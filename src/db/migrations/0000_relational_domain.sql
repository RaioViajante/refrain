CREATE TABLE "album_artists" (
	"album_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"credited_as" text,
	CONSTRAINT "album_artists_pkey" PRIMARY KEY("album_id","artist_id"),
	CONSTRAINT "album_artists_position_unique" UNIQUE("album_id","position"),
	CONSTRAINT "album_artists_position_check" CHECK (position >= 1)
);
--> statement-breakpoint
CREATE TABLE "album_editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_id" uuid NOT NULL,
	"label" text,
	"release_date" date,
	"country" text,
	"mb_release_id" uuid,
	"is_reference" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "album_editions_mb_release_id_unique" UNIQUE("mb_release_id"),
	CONSTRAINT "album_editions_id_album_unique" UNIQUE("id","album_id"),
	CONSTRAINT "album_editions_country_check" CHECK (country ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "album_journals" (
	"entry_id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'album_journal' NOT NULL,
	"album_id" uuid NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"rating_half_steps" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "album_journals_entry_album_unique" UNIQUE("entry_id","album_id"),
	CONSTRAINT "album_journals_kind_check" CHECK (kind = 'album_journal'),
	CONSTRAINT "album_journals_rating_half_steps_check" CHECK (rating_half_steps between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "album_tracks" (
	"album_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	CONSTRAINT "album_tracks_pkey" PRIMARY KEY("album_id","track_id")
);
--> statement-breakpoint
CREATE TABLE "albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"first_release_year" smallint,
	"mb_release_group_id" uuid,
	"cover_url" text,
	"cover_source" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "albums_mb_release_group_id_unique" UNIQUE("mb_release_group_id"),
	CONSTRAINT "albums_title_check" CHECK (btrim(title) <> ''),
	CONSTRAINT "albums_first_release_year_check" CHECK (first_release_year between 1800 and 2100),
	CONSTRAINT "albums_cover_source_check" CHECK (cover_url is null or cover_source is not null)
);
--> statement-breakpoint
CREATE TABLE "artist_journals" (
	"entry_id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'artist_journal' NOT NULL,
	"artist_id" uuid NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_journals_kind_check" CHECK (kind = 'artist_journal')
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_name" text,
	"kind" text NOT NULL,
	"mb_artist_id" uuid,
	"photo_url" text,
	"photo_credit" text,
	"photo_license" text,
	"photo_source_url" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artists_mb_artist_id_unique" UNIQUE("mb_artist_id"),
	CONSTRAINT "artists_name_check" CHECK (btrim(name) <> ''),
	CONSTRAINT "artists_kind_check" CHECK (kind in ('person', 'group')),
	CONSTRAINT "artists_photo_attribution_check" CHECK (photo_url is null or (photo_credit is not null and photo_license is not null))
);
--> statement-breakpoint
CREATE TABLE "edition_tracks" (
	"edition_id" uuid NOT NULL,
	"album_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"disc_number" smallint DEFAULT 1 NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "edition_tracks_pkey" PRIMARY KEY("edition_id","track_id"),
	CONSTRAINT "edition_tracks_position_unique" UNIQUE("edition_id","disc_number","position"),
	CONSTRAINT "edition_tracks_disc_number_check" CHECK (disc_number >= 1),
	CONSTRAINT "edition_tracks_position_check" CHECK (position >= 1)
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"first_published_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_id_kind_unique" UNIQUE("id","kind"),
	CONSTRAINT "entries_kind_check" CHECK (kind in ('album_journal', 'artist_journal', 'memory')),
	CONSTRAINT "entries_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
CREATE TABLE "entry_slugs" (
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"is_current" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_slugs_pkey" PRIMARY KEY("kind","slug"),
	CONSTRAINT "entry_slugs_slug_format_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80)
);
--> statement-breakpoint
CREATE TABLE "entry_texts" (
	"entry_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"is_original" boolean NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"title" text,
	"opening" text,
	"body" jsonb,
	"body_format_version" smallint DEFAULT 1 NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"margin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_texts_pkey" PRIMARY KEY("entry_id","locale"),
	CONSTRAINT "entry_texts_locale_check" CHECK (locale in ('en', 'pt-BR')),
	CONSTRAINT "entry_texts_status_check" CHECK (status in ('draft', 'private', 'published')),
	CONSTRAINT "entry_texts_published_at_check" CHECK ((status = 'published') = (published_at is not null)),
	CONSTRAINT "entry_texts_title_check" CHECK (title is null or btrim(title) <> ''),
	CONSTRAINT "entry_texts_body_is_document_check" CHECK (body is null or (jsonb_typeof(body) = 'object' and body ->> 'type' = 'doc')),
	CONSTRAINT "entry_texts_body_text_requires_body_check" CHECK (body is not null or body_text = ''),
	CONSTRAINT "entry_texts_body_format_version_check" CHECK (body_format_version >= 1)
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"entry_id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'memory' NOT NULL,
	"remembered_when" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_kind_check" CHECK (kind = 'memory')
);
--> statement-breakpoint
CREATE TABLE "memory_music" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"memory_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"track_id" uuid,
	"album_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_music_track_unique" UNIQUE("memory_id","track_id"),
	CONSTRAINT "memory_music_album_unique" UNIQUE("memory_id","album_id"),
	CONSTRAINT "memory_music_one_item_check" CHECK (num_nonnulls(track_id, album_id) = 1),
	CONSTRAINT "memory_music_position_check" CHECK (position >= 1)
);
--> statement-breakpoint
CREATE TABLE "track_artists" (
	"track_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "track_artists_pkey" PRIMARY KEY("track_id","artist_id"),
	CONSTRAINT "track_artists_position_unique" UNIQUE("track_id","position"),
	CONSTRAINT "track_artists_position_check" CHECK (position >= 1)
);
--> statement-breakpoint
CREATE TABLE "track_reflection_texts" (
	"track_reflection_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"body" jsonb,
	"body_format_version" smallint DEFAULT 1 NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_reflection_texts_pkey" PRIMARY KEY("track_reflection_id","locale"),
	CONSTRAINT "track_reflection_texts_locale_check" CHECK (locale in ('en', 'pt-BR')),
	CONSTRAINT "track_reflection_texts_body_is_document_check" CHECK (body is null or (jsonb_typeof(body) = 'object' and body ->> 'type' = 'doc')),
	CONSTRAINT "track_reflection_texts_body_text_requires_body_check" CHECK (body is not null or body_text = ''),
	CONSTRAINT "track_reflection_texts_body_format_version_check" CHECK (body_format_version >= 1)
);
--> statement-breakpoint
CREATE TABLE "track_reflections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"album_journal_id" uuid NOT NULL,
	"album_id" uuid NOT NULL,
	"track_id" uuid NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"is_still_writing" boolean DEFAULT false NOT NULL,
	"is_favourite" boolean DEFAULT false NOT NULL,
	"rating_half_steps" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_reflections_journal_track_unique" UNIQUE("album_journal_id","track_id"),
	CONSTRAINT "track_reflections_rating_half_steps_check" CHECK (rating_half_steps between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"length_ms" integer,
	"credit" text,
	"mb_recording_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracks_mb_recording_id_unique" UNIQUE("mb_recording_id"),
	CONSTRAINT "tracks_title_check" CHECK (btrim(title) <> ''),
	CONSTRAINT "tracks_length_ms_check" CHECK (length_ms > 0)
);
--> statement-breakpoint
ALTER TABLE "album_artists" ADD CONSTRAINT "album_artists_album_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_artists" ADD CONSTRAINT "album_artists_artist_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_editions" ADD CONSTRAINT "album_editions_album_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_journals" ADD CONSTRAINT "album_journals_entry_fk" FOREIGN KEY ("entry_id","kind") REFERENCES "public"."entries"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_journals" ADD CONSTRAINT "album_journals_album_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_tracks" ADD CONSTRAINT "album_tracks_album_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_tracks" ADD CONSTRAINT "album_tracks_track_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_journals" ADD CONSTRAINT "artist_journals_entry_fk" FOREIGN KEY ("entry_id","kind") REFERENCES "public"."entries"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_journals" ADD CONSTRAINT "artist_journals_artist_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_tracks" ADD CONSTRAINT "edition_tracks_edition_fk" FOREIGN KEY ("edition_id","album_id") REFERENCES "public"."album_editions"("id","album_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_tracks" ADD CONSTRAINT "edition_tracks_album_track_fk" FOREIGN KEY ("album_id","track_id") REFERENCES "public"."album_tracks"("album_id","track_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_slugs" ADD CONSTRAINT "entry_slugs_entry_fk" FOREIGN KEY ("entry_id","kind") REFERENCES "public"."entries"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_texts" ADD CONSTRAINT "entry_texts_entry_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_entry_fk" FOREIGN KEY ("entry_id","kind") REFERENCES "public"."entries"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_music" ADD CONSTRAINT "memory_music_memory_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("entry_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_music" ADD CONSTRAINT "memory_music_track_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_music" ADD CONSTRAINT "memory_music_album_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_artists" ADD CONSTRAINT "track_artists_track_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_artists" ADD CONSTRAINT "track_artists_artist_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_reflection_texts" ADD CONSTRAINT "track_reflection_texts_reflection_fk" FOREIGN KEY ("track_reflection_id") REFERENCES "public"."track_reflections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_reflections" ADD CONSTRAINT "track_reflections_journal_fk" FOREIGN KEY ("album_journal_id","album_id") REFERENCES "public"."album_journals"("entry_id","album_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_reflections" ADD CONSTRAINT "track_reflections_album_track_fk" FOREIGN KEY ("album_id","track_id") REFERENCES "public"."album_tracks"("album_id","track_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "album_artists_artist_id_idx" ON "album_artists" USING btree ("artist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "album_editions_one_reference_idx" ON "album_editions" USING btree ("album_id") WHERE is_reference;--> statement-breakpoint
CREATE INDEX "album_editions_album_id_idx" ON "album_editions" USING btree ("album_id");--> statement-breakpoint
CREATE UNIQUE INDEX "album_journals_one_featured_idx" ON "album_journals" USING btree ("album_id") WHERE is_featured;--> statement-breakpoint
CREATE INDEX "album_journals_album_id_idx" ON "album_journals" USING btree ("album_id");--> statement-breakpoint
CREATE INDEX "album_tracks_track_id_idx" ON "album_tracks" USING btree ("track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artist_journals_one_featured_idx" ON "artist_journals" USING btree ("artist_id") WHERE is_featured;--> statement-breakpoint
CREATE INDEX "artist_journals_artist_id_idx" ON "artist_journals" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "edition_tracks_album_track_idx" ON "edition_tracks" USING btree ("album_id","track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_slugs_one_current_idx" ON "entry_slugs" USING btree ("entry_id") WHERE is_current;--> statement-breakpoint
CREATE INDEX "entry_slugs_entry_id_idx" ON "entry_slugs" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entry_texts_one_original_idx" ON "entry_texts" USING btree ("entry_id") WHERE is_original;--> statement-breakpoint
CREATE INDEX "memory_music_track_id_idx" ON "memory_music" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "memory_music_album_id_idx" ON "memory_music" USING btree ("album_id");--> statement-breakpoint
CREATE INDEX "track_artists_artist_id_idx" ON "track_artists" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "track_reflections_album_track_idx" ON "track_reflections" USING btree ("album_id","track_id");