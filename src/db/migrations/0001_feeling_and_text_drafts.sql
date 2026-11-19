ALTER TABLE "mixtapes" ADD COLUMN "feeling" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "site_texts" ADD COLUMN "published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mixtapes" ADD CONSTRAINT "mixtapes_feeling_format" CHECK ("mixtapes"."feeling" = '' or "mixtapes"."feeling" ~ '^[a-zà-ÿ]+( [a-zà-ÿ]+)?$' and char_length("mixtapes"."feeling") <= 30);