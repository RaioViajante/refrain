// The note mark beside "Memory" (the V4.4 `Memory` screen), the studio's own
// memory mark in the public stroke. Decorative: the word beside it says what
// it means.
export function NoteIcon({
  className = "pj-icon",
  size = 18,
}: Readonly<{ className?: string; size?: number }>) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 17.5V6l10-2v11.5" />
      <circle cx="7" cy="17.5" r="2" />
      <circle cx="17" cy="15.5" r="2" />
    </svg>
  );
}
