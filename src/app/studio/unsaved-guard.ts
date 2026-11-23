"use client";

// One guard for every Studio form with unsaved changes. While any registered
// form is dirty, leaving the page asks first: closing or reloading the tab
// (the browser's own prompt) and following a link or a control marked
// `data-leaves-page` inside the app (window.confirm). Client-side navigation
// never fires `beforeunload`, so links are caught here, in the capture phase,
// before Next.js's <Link> handles the click. The browser's back and forward
// buttons are not caught.
import { useEffect, useId } from "react";

export const LEAVE_PROMPT = "sair sem salvar as alterações?";

const dirty = new Set<string>();
// Set once the owner has agreed to leave, so a full page load that follows
// does not ask a second time.
let leaving = false;

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!leaving) event.preventDefault();
}

/** Whether a click on this element leaves the current page. */
function leavesPage(element: Element): boolean {
  if (!(element instanceof HTMLAnchorElement)) return true;
  if (element.target && element.target !== "_self") return false;
  if (element.hasAttribute("download")) return false;
  const url = new URL(element.href, window.location.href);
  const here = window.location;
  // A link to a place on this same page (#anchor) keeps the forms.
  return !(
    url.origin === here.origin &&
    url.pathname === here.pathname &&
    url.search === here.search
  );
}

function onClick(event: MouseEvent) {
  if (dirty.size === 0 || event.defaultPrevented || event.button !== 0) return;
  const target =
    event.target instanceof Element
      ? event.target.closest("a[href], [data-leaves-page]")
      : null;
  if (!target || !leavesPage(target)) return;
  // A modified click on a link opens it elsewhere (new tab or window) and
  // keeps this page; on a control such as "sair" it still leaves.
  const modified =
    event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  if (modified && target instanceof HTMLAnchorElement) return;
  if (window.confirm(LEAVE_PROMPT)) {
    leaving = true;
    window.setTimeout(() => (leaving = false), 1000);
  } else {
    event.preventDefault();
    event.stopPropagation();
  }
}

function add(id: string) {
  if (dirty.size === 0) {
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
  }
  dirty.add(id);
}

function remove(id: string) {
  dirty.delete(id);
  if (dirty.size === 0) {
    window.removeEventListener("beforeunload", onBeforeUnload);
    document.removeEventListener("click", onClick, true);
  }
}

/** Registers this form's unsaved state with the page's guard. */
export function useUnsavedGuard(isDirty: boolean) {
  const id = useId();
  useEffect(() => {
    if (!isDirty) return;
    add(id);
    return () => remove(id);
  }, [id, isDirty]);
}
