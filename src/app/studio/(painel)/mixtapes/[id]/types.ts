import type { ImageUsage } from "@/server/studio/images";

/** The fields "salvar" sends to saveMixtapeAction, as the form holds them. */
export type TapeFields = {
  title: string;
  slug: string;
  theme: string;
  feeling: string;
  description: string;
  reflection: string;
  pullQuote: string;
  pullQuoteCredit: string;
  detailCaption: string;
  playlistUrl: string;
  year: string;
  featuredRank: "" | "1" | "2" | "3" | string;
};

/** The photograph's own fields (updateImageAction). */
export type ImageEdit = {
  alt: string;
  focus: number;
  treatment: "mood" | "original";
  rightsConfirmed: boolean;
  rightsNote: string;
};

export type EditorImage = ImageEdit & {
  id: string;
  url: string;
  width: number;
  height: number;
  usage: ImageUsage[];
};

export type EditorTrack = {
  id: string;
  title: string;
  artist: string;
  note: string;
  noteSide: "left" | "right";
};

export type EditorTape = {
  id: string;
  number: number;
  published: boolean;
  fields: TapeFields;
  savedSlug: string;
  cover: EditorImage | null;
  detail: EditorImage | null;
  tracks: EditorTrack[];
};

export type LibraryImage = {
  id: string;
  url: string;
  alt: string;
  treatment: "mood" | "original";
  focus: number;
  rightsConfirmed: boolean;
};

export type NoteDraft = { note: string; noteSide: "left" | "right" };

export const FOCUS_POSITIONS = [
  "0% 0%",
  "50% 0%",
  "100% 0%",
  "0% 50%",
  "50% 50%",
  "100% 50%",
  "0% 100%",
  "50% 100%",
  "100% 100%",
] as const;

export const FOCUS_NAMES = [
  "topo à esquerda",
  "topo",
  "topo à direita",
  "esquerda",
  "centro",
  "direita",
  "base à esquerda",
  "base",
  "base à direita",
] as const;

export function editOf(image: EditorImage): ImageEdit {
  return {
    alt: image.alt,
    focus: image.focus,
    treatment: image.treatment,
    rightsConfirmed: image.rightsConfirmed,
    rightsNote: image.rightsNote,
  };
}
