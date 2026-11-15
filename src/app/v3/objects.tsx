import type { CSSProperties, ReactNode } from "react";

// The v3 physical objects that more than one page uses (docs/design-system.md,
// Part I, Physical objects), built as the reference builds them. Everything
// here is decorative markup around real text, and is aria-hidden where it
// carries no meaning of its own.

/** A small deterministic generator, so a ragged edge is the same on every request. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The ragged ends of kraft tape and labels, as the reference draws them: eight
 * points down each end, the left within 0–`depth`% and the right within
 * (100 − depth)–100%.
 */
export function raggedEnds(seed: string, depth = 5): string {
  const random = seeded(seed);
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i < 8; i++) {
    const y = ((i / 7) * 100).toFixed(1);
    left.push(`${(random() * depth).toFixed(1)}% ${y}%`);
  }
  for (let i = 7; i >= 0; i--) {
    const y = ((i / 7) * 100).toFixed(1);
    right.push(`${(100 - random() * depth).toFixed(1)}% ${y}%`);
  }
  return `polygon(${left.join(",")},${right.join(",")})`;
}

/** A tilt between −max and +max degrees, from the seed. */
export function tilt(seed: string, max: number): string {
  const random = seeded(`${seed}:tilt`);
  return `${((random() * 2 - 1) * max).toFixed(1)}deg`;
}

export function Vinyl({
  top,
  bottom,
  className = "",
  ringText,
  style,
}: Readonly<{
  /** The label's handwritten line. */
  top?: ReactNode;
  /** The label's pixel line. */
  bottom?: ReactNode;
  className?: string;
  /** Text set around the record's edge, turning slowly. */
  ringText?: string;
  style?: CSSProperties;
}>) {
  return (
    <span
      className={`vinyl ${className}`.trim()}
      aria-hidden="true"
      style={style}
    >
      <span className="sheen" />
      {ringText ? (
        <svg className="rtxt" viewBox="0 0 600 600" aria-hidden="true">
          <defs>
            <path
              id="pp-rtxt"
              d="M300 300 m-270 0 a270 270 0 1 1 540 0 a270 270 0 1 1 -540 0"
            />
          </defs>
          <text>
            <textPath href="#pp-rtxt">{ringText}</textPath>
          </text>
        </svg>
      ) : null}
      <span className="lbl">
        {top !== undefined ? <span className="t1 hand">{top}</span> : null}
        {bottom !== undefined ? <span className="t2 pix">{bottom}</span> : null}
      </span>
    </span>
  );
}

/** A kraft label; `href` makes it a link. */
export function Kraft({
  children,
  seed,
  href,
  link = false,
  rotate,
  className = "",
  style,
  lang,
}: Readonly<{
  children: ReactNode;
  seed: string;
  href?: string;
  /** The Archivo link variant. */
  link?: boolean;
  rotate?: string;
  className?: string;
  style?: CSSProperties;
  lang?: string;
}>) {
  const look: CSSProperties = {
    clipPath: raggedEnds(seed),
    rotate: rotate ?? tilt(seed, 1.5),
    ...style,
  };
  const classes = `kr ${link ? "lnk" : "hand"} ${className}`.trim();
  return href ? (
    <a className={classes} href={href} style={look} lang={lang}>
      {children}
    </a>
  ) : (
    <span className={classes} style={look} lang={lang}>
      {children}
    </span>
  );
}

/** A pin or a strip of tape on a polaroid. */
export function Attachment({
  kind,
  seed,
}: Readonly<{ kind: "pin" | "tape"; seed: string }>) {
  return kind === "pin" ? (
    <span className="pin" aria-hidden="true" />
  ) : (
    <span
      className="tape"
      aria-hidden="true"
      style={{ clipPath: raggedEnds(seed, 4), rotate: tilt(seed, 4) }}
    />
  );
}

/** The pen circle drawn around a favourite or a rating. */
export function PenRing({
  d,
  viewBox = "0 0 120 50",
}: Readonly<{ d?: string; viewBox?: string }>) {
  return (
    <svg
      className="penring"
      viewBox={viewBox}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        pathLength={1}
        d={
          d ??
          "M14 14.9 Q19.7 9.6 27 8.5 Q34.3 7.4 40.6 5.5 Q46.9 3.6 54.8 4.7 Q62.7 5.8 70.2 5.7 Q77.6 5.7 85.4 6.3 Q93.1 7 96.6 9.8 Q100 12.5 106.4 14.2 Q112.8 15.9 112.4 18.8 Q112 21.7 114.4 24.4 Q116.8 27.1 115.7 29.9 Q114.7 32.7 110 35 Q105.4 37.3 101.5 39.9 Q97.6 42.6 90.5 44.1 Q83.4 45.6 75.1 45.6 Q66.9 45.5 59.2 45.6 Q51.5 45.8 43.8 45.2 Q36.1 44.5 30.9 42.3 Q25.7 40.2 20.8 38.2 Q15.9 36.3 12.7 33.9 Q9.6 31.5 6.4 29 Q3.3 26.5 5.1 23.8 Q7 21.1 8.8 18.5 Q10.6 15.9 13.3 13.2 Q16.1 10.5 22.3 8.7 Q28.5 6.9 35.4 5.3 Q42.3 3.7 50.4 3.8 L58.6 3.8"
        }
      />
    </svg>
  );
}

/** The torn edges of the navy sheet. */
export function TornEdge({ side }: Readonly<{ side: "t" | "b" }>) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed decorative edge
    <img
      className={`edge ${side}`}
      src={side === "t" ? "/v3/torn-top.png" : "/v3/torn-bottom.png"}
      alt=""
      aria-hidden="true"
      loading="lazy"
    />
  );
}
