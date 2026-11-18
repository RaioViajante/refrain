// The arrow after an "All …" link on the Home (the V4.4 `Home` screen), drawn
// in the public stroke as the other marks are: one line and its head, no
// asset, no icon package. Decorative: the words before it name the link.
export function ArrowIcon({
  className = "pj-icon",
  size = 16,
  back = false,
}: Readonly<{ className?: string; size?: number; back?: boolean }>) {
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
      {back ? (
        <>
          <path d="M20 12.2c-4.9-.3-9.9-.2-15 0" />
          <path d="M10.6 6.4 4.8 12l5.6 5.6" />
        </>
      ) : (
        <>
          <path d="M4 12.2c4.9-.3 9.9-.2 15 0" />
          <path d="M13.4 6.4 19.2 12l-5.6 5.6" />
        </>
      )}
    </svg>
  );
}
