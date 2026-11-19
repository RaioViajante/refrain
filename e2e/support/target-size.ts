import type { Page } from "@playwright/test";

const INTERACTIVE = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="switch"]',
].join(",");

/** The project's minimum target (AGENTS.md § 5). */
const TARGET = 44;

/**
 * A control without a 44 × 44 px target. `width` and `height` are how far
 * its hit area reaches through its centre, in whole pixels, capped a little
 * above 44. `overlaps` names the `rows` selector when overlap with that row's
 * other controls is the only fault (see `findUndersizedTargets`).
 */
export type UndersizedTarget = {
  route: string;
  tag: string;
  name: string;
  width: number;
  height: number;
  overlaps?: string;
};

/**
 * Enforces the 44 × 44 px target rule on every visible control in `scope`.
 *
 * A control's target is its own box or the box of one of its labels (a label
 * activates its control). A target passes when both hold:
 *
 * - **Size:** its own area measures at least 44 × 44 px: the box, joined
 *   with each absolutely positioned `::before` / `::after` that covers the
 *   box's centre, placed from its used size, offsets, and `translate` (a
 *   pseudo-element with `transform`, `rotate`, or `scale` is not counted).
 * - **Hit area:** from the box's centre, `elementFromPoint` keeps answering
 *   with the control (pseudo-elements report as their element), its
 *   descendants, or its labels for at least 44 whole pixels across and 44
 *   down, and at points inside the disc they span. A neighbour painted over
 *   the target, or an enlarged area spilling onto a neighbour's, fails here.
 *
 * Hit-testing resolves whole pixels; the size check makes plain boxes exact.
 *
 * `rows` lists selectors of controls stacked closer than 44 px by design: a
 * failing control that matches one, passes the size check, and is the
 * control `elementFromPoint` answers with at its centre is still reported,
 * with `overlaps` set to the selector, so the caller can tell it apart. What
 * it holds alone is then cut by the next row's area or, in a multi-column
 * list, by its column's end (Chromium does not hit-test overflow past a
 * column). A covered control, one whose centre is not clickable, or one
 * whose own area is under 44 × 44 px is never tolerated.
 *
 * Controls behind an open modal dialog are inert and skipped. A control kept
 * off the page until focused (the skip link) is measured while focused. Run
 * with `reducedMotion: "reduce"` so scroll-driven reveals do not move targets
 * while they are measured.
 */
export async function findUndersizedTargets(
  page: Page,
  scope = "body",
  rows: readonly string[] = [],
): Promise<UndersizedTarget[]> {
  const targets = await page
    .locator(scope)
    .locator(INTERACTIVE)
    .evaluateAll(
      (elements, [size, rows]) => {
        const modal = document.querySelector("dialog:modal");
        const visible = (node: Element) =>
          node.checkVisibility({ visibilityProperty: true }) &&
          node.getClientRects().length > 0;
        const clean = (text: string | null | undefined) =>
          text?.trim().replace(/\s+/g, " ") || null;
        // The box joined with each absolutely positioned pseudo-element that
        // covers its centre, from the pseudo-element's used size and offsets
        // (relative to the box's padding edge, which is its containing block
        // when the box is positioned).
        const ownArea = (node: Element) => {
          const box = node.getBoundingClientRect();
          let { left, top, right, bottom } = box;
          const style = getComputedStyle(node);
          if (style.position !== "static") {
            const x0 = box.left + Number.parseFloat(style.borderLeftWidth);
            const y0 = box.top + Number.parseFloat(style.borderTopWidth);
            const cx = box.left + box.width / 2;
            const cy = box.top + box.height / 2;
            for (const pseudo of ["::before", "::after"] as const) {
              const p = getComputedStyle(node, pseudo);
              if (
                p.content === "none" ||
                p.display === "none" ||
                p.position !== "absolute" ||
                p.transform !== "none" ||
                p.rotate !== "none" ||
                p.scale !== "none"
              ) {
                continue;
              }
              const width = Number.parseFloat(p.width);
              const height = Number.parseFloat(p.height);
              const [tx = "0px", ty = "0px"] =
                p.translate === "none" ? [] : p.translate.split(" ");
              const shift = (t: string, length: number) =>
                t.endsWith("%")
                  ? (Number.parseFloat(t) / 100) * length
                  : Number.parseFloat(t);
              const l = x0 + Number.parseFloat(p.left) + shift(tx, width);
              const t = y0 + Number.parseFloat(p.top) + shift(ty, height);
              if (
                ![width, height, l, t].every(Number.isFinite) ||
                cx < l ||
                cx > l + width ||
                cy < t ||
                cy > t + height
              ) {
                continue;
              }
              left = Math.min(left, l);
              top = Math.min(top, t);
              right = Math.max(right, l + width);
              bottom = Math.max(bottom, t + height);
            }
          }
          return { width: right - left, height: bottom - top };
        };

        return elements.flatMap((element) => {
          if (!(element instanceof HTMLElement)) return [];
          if (modal && !modal.contains(element)) return [];
          if (element.closest("[inert]")) return [];

          const labels =
            "labels" in element && element.labels instanceof NodeList
              ? [...(element.labels as NodeListOf<HTMLLabelElement>)]
              : [];
          const boxes = [element, ...labels].filter(visible);
          if (boxes.length === 0) return [];

          const owns = (x: number, y: number) => {
            const node = document.elementFromPoint(x, y);
            return (
              node !== null &&
              (element.contains(node) || labels.some((l) => l.contains(node)))
            );
          };

          const rect = element.getBoundingClientRect();
          const offPage =
            rect.bottom + window.scrollY <= 0 ||
            rect.right + window.scrollX <= 0;
          if (offPage) element.focus({ preventScroll: true });

          let best = { width: 0, height: 0 };
          let passes = false;
          let overlaps: string | undefined;
          for (const box of boxes) {
            box.scrollIntoView({ block: "center", inline: "center" });
            const r = box.getBoundingClientRect();
            const x = Math.round(r.left + r.width / 2);
            const y = Math.round(r.top + r.height / 2);
            const reach = (dx: number, dy: number) => {
              let n = 0;
              while (
                n < size / 2 + 4 &&
                owns(x + dx * (n + 1), y + dy * (n + 1))
              ) {
                n += 1;
              }
              return n;
            };
            const centre = owns(x, y);
            const width = centre ? reach(-1, 0) + reach(1, 0) + 1 : 0;
            const height = centre ? reach(0, -1) + reach(0, 1) + 1 : 0;
            const inner = [-15, -11, 11, 15].every((d) =>
              [d, -d].every((e) => owns(x + d, y + e)),
            );
            const own = ownArea(box);
            const sized = own.width >= 43.99 && own.height >= 43.99;
            if (width >= size && height >= size && inner && sized) {
              passes = true;
              break;
            }
            if (sized && centre) {
              overlaps ??= rows.find((row) => element.matches(row));
            }
            const shown = sized
              ? { width, height }
              : {
                  width: Math.min(width, Math.floor(own.width)),
                  height: Math.min(height, Math.floor(own.height)),
                };
            if (
              Math.min(shown.width, shown.height) >=
              Math.min(best.width, best.height)
            ) {
              best = shown;
            }
          }
          if (offPage) element.blur();
          if (passes) return [];

          const name =
            element.getAttribute("aria-label") ??
            clean(labels[0]?.textContent) ??
            element.getAttribute("placeholder") ??
            clean(element.textContent) ??
            element.getAttribute("name") ??
            element.id;

          return [
            {
              tag: element.tagName.toLowerCase(),
              name: name.slice(0, 80),
              ...best,
              ...(overlaps ? { overlaps } : {}),
            },
          ];
        });
      },
      [TARGET, rows] as const,
    );
  const route = new URL(page.url()).pathname;
  return targets.map((target) => ({ route, ...target }));
}
