// A handful of line icons for the Writing Studio, drawn on a 24-unit grid with
// one ink stroke (docs/design-system.md § Components). Decorative: they sit
// beside a word and are hidden from assistive technology.

const SHAPES = {
  // A page and a pencil: the Writing studio label.
  studio: (
    <>
      <path d="M11 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" />
      <path d="m18.5 4.5 1.5 1.5-8 8-2.6.7.7-2.6z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  album: (
    <>
      <path d="M5 5h14v14H5z" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="12" cy="12" r="0.6" />
    </>
  ),
  artist: (
    <>
      <circle cx="12" cy="8.5" r="3.4" />
      <path d="M5.5 19.5c.4-3.6 3-5.5 6.5-5.5s6.1 1.9 6.5 5.5" />
    </>
  ),
  note: (
    <>
      <path d="M9 17.5V6l10-2v11.5" />
      <circle cx="7" cy="17.5" r="2" />
      <circle cx="17" cy="15.5" r="2" />
    </>
  ),
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l.9 12h8.2L17 7M10.5 11v5M13.5 11v5" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  // Opens and closes a track: it turns a quarter when the track is open.
  chevron: <path d="m9 6 6 6-6 6" />,
} as const;

export type IconName = keyof typeof SHAPES;

export function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="studio-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
