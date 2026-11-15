"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { REVEAL_SOUNDS, soundEngine } from "./sfx";

// The v3 page runtime (docs/design-system.md, Part I, Motion and Sound), a
// port of the reference's page lifecycle:
//
// - an IntersectionObserver gives each [data-a] / [data-io] element the class
//   `on` once, as it enters the page, and then forgets it;
// - the pen's quiet scribble on hover (mouse only, sound on only);
// - a pen click for links and buttons (sound on only);
// - the Home hero's scroll variable `--hp`, not under reduced motion.
//
// Everything is visible without JavaScript: the class that arms the entrance
// animations (`io`) is added only here, or by the pre-paint script in the
// frame, which also releases every element if this island never arrives.
// Listeners and the observer are removed when the page changes.

const OBSERVED = ".pp [data-io], .pp [data-a]";
const PEN_TARGETS =
  ".pp .hdr nav a:not([aria-current]), .pp .ftr nav a, .pp .lang a, .pp .lang button, .pp .sorts button, .pp .sorts a";

export function V3Runtime() {
  const pathname = usePathname();
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".pp");
    if (!root) return;
    root.dataset.runtime = "ready";
    const cleanups: (() => void)[] = [];
    const sfx = soundEngine();

    if ("IntersectionObserver" in window) {
      root.classList.add("io");
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const element = entry.target as HTMLElement;
            element.classList.add("on");
            reveal(element);
            observer.unobserve(element);
          }
        },
        { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
      );
      root.querySelectorAll(OBSERVED).forEach((element) => {
        if (!element.classList.contains("on")) observer.observe(element);
      });
      // When the reader turns sound on, what they have not reached yet plays
      // as it arrives; what is already on screen stays quiet.
      const unsubscribe = sfx.subscribe((on) => {
        if (!on) return;
        root.querySelectorAll<HTMLElement>(".on").forEach((element) => {
          const box = element.getBoundingClientRect();
          if (box.bottom < 0 || box.top > window.innerHeight) {
            element.classList.remove("on");
            observer.observe(element);
          }
        });
      });
      cleanups.push(() => {
        observer.disconnect();
        unsubscribe();
      });
    } else {
      root.querySelectorAll(OBSERVED).forEach((element) => element.classList.add("on"));
    }

    function reveal(element: HTMLElement) {
      if (!sfx.isOn()) return;
      const kind = element.getAttribute("data-a");
      const delay = (Number.parseInt(element.getAttribute("data-d") ?? "0", 10) || 0) * 0.11;
      if (kind) {
        const sound = REVEAL_SOUNDS[kind];
        if (sound) sfx.play(sound, delay);
        return;
      }
      if (element.classList.contains("orb2")) {
        element.querySelectorAll(".ri img, .ri .wl").forEach((_, i) => {
          if (i % 6 === 0) {
            sfx.play("grow", 0.7 + Math.floor(i / 8) * 0.45 + (i % 16) * 0.045, true);
          }
        });
        sfx.play("rec", 0, true);
        return;
      }
      if (element.classList.contains("torn")) sfx.play("rip", 0, true);
    }

    let lastPen = 0;
    let lastElement: EventTarget | null = null;
    const onPen = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      const target = event.currentTarget as HTMLElement;
      if (target.getAttribute("aria-pressed") === "true") return;
      if (target.getAttribute("aria-current")) return;
      const n = performance.now();
      if (n - lastPen < 160 || (target === lastElement && n - lastPen < 600)) return;
      lastPen = n;
      lastElement = target;
      sfx.play("scribble", 0, true);
    };
    const penElements = Array.from(root.querySelectorAll<HTMLElement>(PEN_TARGETS));
    penElements.forEach((element) => element.addEventListener("pointerenter", onPen));
    cleanups.push(() =>
      penElements.forEach((element) => element.removeEventListener("pointerenter", onPen)),
    );

    const onClick = (event: MouseEvent) => {
      const target = (event.target as Element | null)?.closest?.("a, button, [role='button']");
      if (!target || !root.contains(target)) return;
      if (target.classList.contains("snd") || target.classList.contains("trow")) return;
      sfx.play("click", 0, true);
    };
    root.addEventListener("click", onClick);
    cleanups.push(() => root.removeEventListener("click", onClick));

    const hero = root.querySelector<HTMLElement>(".hero");
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (hero && !still) {
      let busy = false;
      const onScroll = () => {
        if (busy) return;
        busy = true;
        requestAnimationFrame(() => {
          busy = false;
          const box = hero.getBoundingClientRect();
          const progress = Math.min(1, Math.max(0, -box.top / Math.max(1, box.height)));
          hero.style.setProperty("--hp", progress.toFixed(3));
        });
      };
      window.addEventListener("scroll", onScroll, { passive: true, capture: true });
      onScroll();
      cleanups.push(() => window.removeEventListener("scroll", onScroll, { capture: true }));
    }

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [pathname]);
  return null;
}

/** The footer's sound control: off until the reader turns it on. */
export function SoundToggle({ label }: Readonly<{ label: string }>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sfx = soundEngine();
    setOn(sfx.isOn());
    return sfx.subscribe(setOn);
  }, []);
  return (
    <button
      type="button"
      className="snd"
      aria-pressed={on ? "true" : "false"}
      onClick={() => soundEngine().set(!soundEngine().isOn())}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path className="bx" d="M4 9.5 H8 L13 5.5 V18.5 L8 14.5 H4 Z" />
        <path className="w1" d="M16 9 Q18 12 16 15" />
        <path className="w2" d="M18.5 6.5 Q22.5 12 18.5 17.5" />
      </svg>
      <span>{label}</span>
    </button>
  );
}

/** A disclosure that plays the page sound as it opens and closes. */
export function useTrackSound() {
  return (open: boolean) => soundEngine().play(open ? "open" : "close", 0, true);
}
