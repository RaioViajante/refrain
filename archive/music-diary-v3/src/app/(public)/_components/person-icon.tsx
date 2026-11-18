// The person mark beside "Artist" and inside an empty photograph frame (the
// V4.4 `Artist` screen). Decorative: the words beside it say what it means.
export function PersonIcon({
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
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20.2c.6-3.9 3.5-6.4 7.2-6.4s6.6 2.5 7.2 6.4" />
    </svg>
  );
}
