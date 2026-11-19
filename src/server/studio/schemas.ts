// Validation for every Studio input (form data and ids), with the same limits
// as the database's CHECK constraints and messages in Portuguese.
import { z } from "zod";

import { SITE_IMAGES, type SiteImageSlot } from "@/content/site-images";
import { SITE_TEXTS, type SiteTextKey } from "@/content/site-texts";

const text = (max: number, label: string) =>
  z.string().trim().max(max, `${label}: no máximo ${max} caracteres.`);

export const idSchema = z.uuid("identificador inválido.");

export const titleSchema = z
  .string()
  .trim()
  .min(1, "o título não pode ficar vazio.")
  .max(120, "o título tem no máximo 120 caracteres.");

export const mixtapeFieldsSchema = z.object({
  title: titleSchema,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(80, "o endereço tem no máximo 80 caracteres.")
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "o endereço usa só letras minúsculas, números e hífens.",
    ),
  theme: text(120, "tema"),
  feeling: z
    .string()
    .trim()
    .toLowerCase()
    .max(30, "sentimento: no máximo 30 caracteres.")
    .regex(/^$|^[a-zà-ÿ]+( [a-zà-ÿ]+)?$/, "sentimento: uma ou duas palavras."),
  description: text(600, "frase da fita"),
  reflection: text(20_000, "reflexão"),
  pullQuote: text(600, "citação"),
  pullQuoteCredit: text(200, "sobre a citação"),
  detailCaption: text(200, "legenda"),
  playlistUrl: z
    .string()
    .trim()
    .max(500, "o link tem no máximo 500 caracteres.")
    .refine((v) => v === "" || /^https:\/\/\S+$/.test(v), {
      message: "o link precisa começar com https://",
    })
    .transform((v) => v || null),
  year: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || (/^\d{4}$/.test(v) && +v >= 1900 && +v <= 2100),
      {
        message: "o ano tem quatro dígitos, entre 1900 e 2100.",
      },
    )
    .transform((v) => (v ? Number(v) : null)),
  featuredRank: z
    .enum(["", "1", "2", "3"], "destaque inválido.")
    .transform((v) => (v ? Number(v) : null)),
});
export type MixtapeFields = z.output<typeof mixtapeFieldsSchema>;

export const songSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "a música precisa de um nome.")
    .max(200, "o nome tem no máximo 200 caracteres."),
  artist: z
    .string()
    .trim()
    .min(1, "a música precisa de um artista.")
    .max(200, "o artista tem no máximo 200 caracteres."),
});
export type SongInput = z.output<typeof songSchema>;

export const noteSchema = z.object({
  note: text(1000, "anotação"),
  noteSide: z.enum(["left", "right"], "lado inválido."),
});

export const directionSchema = z.enum(["up", "down"], "direção inválida.");

export const siteTextKeySchema = z
  .string()
  .refine((k): k is SiteTextKey => k in SITE_TEXTS, "texto desconhecido.");
export const siteTextBodySchema = text(20_000, "texto");

export const siteImageSlotSchema = z
  .string()
  .refine((k): k is SiteImageSlot => k in SITE_IMAGES, "espaço desconhecido.");

export const imageFieldsSchema = z.object({
  alt: z
    .string()
    .trim()
    .min(1, "descreva a foto para quem não pode vê-la.")
    .max(300, "a descrição tem no máximo 300 caracteres."),
  focus: z.coerce.number().int().min(0).max(8),
  treatment: z.enum(["mood", "original"], "tratamento inválido."),
  rightsConfirmed: z.boolean(),
  rightsNote: text(500, "nota sobre os direitos"),
});
export type ImageFields = z.output<typeof imageFieldsSchema>;

/** The first message of each field, for a form. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
