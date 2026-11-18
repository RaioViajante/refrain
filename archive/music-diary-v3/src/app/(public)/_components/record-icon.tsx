// The record mark beside "Album journal" and inside an empty artwork frame:
// one drawing for every public page. Decorative: the words beside it say
// what it means.
export function RecordIcon({
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
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </svg>
  );
}
