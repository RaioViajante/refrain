// A rating shown as five hand-weighted stars in half steps (docs/design-system.md
// § Components, Rating). The value is in half steps (0 to 10). The stars are
// decorative: the accessible name is the sentence, because a screen reader
// should hear "4.5 out of 5" and not five shapes.

const SIZE = 24;
const CENTER = { x: 12, y: 12.8 };
const OUTER = 10.5;
const INNER = 4.4;

function point(angleDegrees: number, radius: number): [number, number] {
  const angle = (angleDegrees * Math.PI) / 180;
  return [
    CENTER.x + radius * Math.cos(angle),
    CENTER.y + radius * Math.sin(angle),
  ];
}

const format = (points: [number, number][]) =>
  points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L");

// Outer points at -90, -18, 54, 126, 198 degrees; inner points between them.
const OUTER_ANGLES = [-90, -18, 54, 126, 198];
const full: [number, number][] = OUTER_ANGLES.flatMap((angle) => [
  point(angle, OUTER),
  point(angle + 36, INNER),
]);
// The left half runs from the top point round to the notch at the bottom.
const left: [number, number][] = [
  point(-90, OUTER),
  point(-126, INNER),
  point(198, OUTER),
  point(162, INNER),
  point(126, OUTER),
  point(90, INNER),
];
const FULL_PATH = `M${format(full)} Z`;
const HALF_PATH = `M${format(left)} Z`;

type Fill = "full" | "half" | "empty";

function fills(halfSteps: number): Fill[] {
  return [1, 2, 3, 4, 5].map((star) => {
    if (halfSteps >= star * 2) return "full";
    if (halfSteps === star * 2 - 1) return "half";
    return "empty";
  });
}

/** "4.5" for 9 half steps; a whole number has no decimal. */
export function ratingText(halfSteps: number): string {
  return Number.isInteger(halfSteps / 2)
    ? String(halfSteps / 2)
    : (halfSteps / 2).toFixed(1);
}

export function Stars({
  halfSteps,
  label,
  size,
}: Readonly<{ halfSteps: number; label: string; size: number }>) {
  return (
    <span className="pj-stars" role="img" aria-label={label}>
      {fills(halfSteps).map((fill, index) => (
        <svg
          key={index}
          width={size}
          height={size}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          aria-hidden="true"
          focusable="false"
        >
          <path
            d={FULL_PATH}
            fill={fill === "full" ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          {fill === "half" ? <path d={HALF_PATH} fill="currentColor" /> : null}
        </svg>
      ))}
    </span>
  );
}
