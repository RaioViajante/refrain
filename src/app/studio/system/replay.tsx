"use client";

/**
 * "Play again" for the motion samples: each sample's entrance runs again.
 * Under reduced motion nothing moves, so the button changes nothing visible.
 */
export function ReplayMotion({ label }: Readonly<{ label: string }>) {
  return (
    <button
      type="button"
      className="pill ghost"
      onClick={(event) => {
        const section = event.currentTarget.closest("section");
        section
          ?.querySelectorAll<HTMLElement>(".mot [data-a]")
          .forEach((element) => {
            element.classList.remove("on");
            // Read the layout so the removal takes effect before the class returns.
            void element.offsetWidth;
            element.classList.add("on");
          });
      }}
    >
      {label}
    </button>
  );
}
