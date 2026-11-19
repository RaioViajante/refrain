CREATE TABLE "image_files" (
	"image_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_files_content_type" CHECK ("image_files"."content_type" in ('image/jpeg', 'image/png')),
	CONSTRAINT "image_files_byte_size" CHECK ("image_files"."byte_size" between 1 and 4194304 and "image_files"."byte_size" = octet_length("image_files"."bytes"))
);
--> statement-breakpoint
ALTER TABLE "images" DROP CONSTRAINT "images_url_source";--> statement-breakpoint
DROP INDEX "images_url_key";--> statement-breakpoint
ALTER TABLE "image_files" ADD CONSTRAINT "image_files_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" DROP COLUMN "url";