CREATE TABLE "text_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text NOT NULL,
	"subject_key" text NOT NULL,
	"field" text NOT NULL,
	"label" text NOT NULL,
	"body" text NOT NULL,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone DEFAULT now() + interval '720 hours' NOT NULL,
	CONSTRAINT "text_versions_subject_field" CHECK (("text_versions"."subject" = 'site_text' and "text_versions"."field" = 'body')
        or ("text_versions"."subject" = 'mixtape' and "text_versions"."field" in ('reflection', 'description', 'pull_quote', 'pull_quote_credit', 'detail_caption'))
        or ("text_versions"."subject" = 'track' and "text_versions"."field" = 'note')),
	CONSTRAINT "text_versions_subject_key" CHECK (("text_versions"."subject" = 'site_text' and "text_versions"."subject_key" ~ '^[a-z0-9]+(\.[a-z0-9_]+)+$')
        or ("text_versions"."subject" in ('mixtape', 'track') and "text_versions"."subject_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),
	CONSTRAINT "text_versions_label_length" CHECK (char_length("text_versions"."label") between 1 and 300),
	CONSTRAINT "text_versions_body_length" CHECK (char_length("text_versions"."body") between 1 and 20000),
	CONSTRAINT "text_versions_retention" CHECK ("text_versions"."purge_after" > "text_versions"."replaced_at" and "text_versions"."purge_after" <= replaced_at + interval '720 hours')
);
--> statement-breakpoint
CREATE TABLE "trash_files" (
	"trash_item_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trash_files_content_type" CHECK ("trash_files"."content_type" in ('image/jpeg', 'image/png')),
	CONSTRAINT "trash_files_byte_size" CHECK ("trash_files"."byte_size" between 1 and 4194304 and "trash_files"."byte_size" = octet_length("trash_files"."bytes"))
);
--> statement-breakpoint
CREATE TABLE "trash_image_refs" (
	"trash_item_id" uuid NOT NULL,
	"image_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trash_image_refs_trash_item_id_image_id_pk" PRIMARY KEY("trash_item_id","image_id")
);
--> statement-breakpoint
CREATE TABLE "trash_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"label" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_version" smallint NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone DEFAULT now() + interval '720 hours' NOT NULL,
	CONSTRAINT "trash_items_kind" CHECK ("trash_items"."kind" in ('mixtape', 'song', 'track', 'image')),
	CONSTRAINT "trash_items_label_length" CHECK (char_length("trash_items"."label") between 1 and 500),
	CONSTRAINT "trash_items_payload_object" CHECK (jsonb_typeof("trash_items"."payload") = 'object'),
	CONSTRAINT "trash_items_payload_version" CHECK ("trash_items"."payload_version" > 0),
	CONSTRAINT "trash_items_retention" CHECK ("trash_items"."purge_after" > "trash_items"."deleted_at" and "trash_items"."purge_after" <= deleted_at + interval '720 hours')
);
--> statement-breakpoint
ALTER TABLE "trash_files" ADD CONSTRAINT "trash_files_trash_item_id_trash_items_id_fk" FOREIGN KEY ("trash_item_id") REFERENCES "public"."trash_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_image_refs" ADD CONSTRAINT "trash_image_refs_trash_item_id_trash_items_id_fk" FOREIGN KEY ("trash_item_id") REFERENCES "public"."trash_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trash_image_refs" ADD CONSTRAINT "trash_image_refs_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "text_versions_subject_idx" ON "text_versions" USING btree ("subject","subject_key","field","replaced_at");--> statement-breakpoint
CREATE INDEX "text_versions_purge_after_idx" ON "text_versions" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "trash_image_refs_image_idx" ON "trash_image_refs" USING btree ("image_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trash_items_subject_key" ON "trash_items" USING btree ("kind","subject_id");--> statement-breakpoint
CREATE INDEX "trash_items_purge_after_idx" ON "trash_items" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "trash_items_deleted_at_idx" ON "trash_items" USING btree ("deleted_at");