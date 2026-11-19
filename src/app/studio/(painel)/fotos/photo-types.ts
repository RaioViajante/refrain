// Shared by the photos screen's server page and its client parts.
export type StudioPhoto = {
  id: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  focus: number;
  treatment: "mood" | "original";
  rightsConfirmed: boolean;
  rightsNote: string;
  /** Where the photo appears, in words ("capa de core", a slot's label). */
  usage: string[];
};

/** images.focus, 0 = top left … 8 = bottom right (the editor's names). */
export const FOCUS_LABELS = [
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

export const MAX_UPLOAD_MB = 4;
