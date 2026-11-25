// Browser form restoration can run after React hydration/pageshow. Clear the DOM as well as memory.
// Hide the page during restoration so a captured form value is not painted before cleanup.
export function installPagePrivacy(
  root: HTMLElement,
  reset: () => void,
  restoreTab?: () => boolean,
) {
  let timer: ReturnType<typeof setTimeout> | undefined, frame: number | undefined;
  const clearFields = () => {
    for (const field of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea",
    )) {
      if (
        field instanceof HTMLInputElement &&
        (field.type === "checkbox" || field.type === "radio")
      ) {
        field.checked = false;
        field.defaultChecked = false;
      } else {
        field.value = "";
        field.defaultValue = "";
      }
    }
  };
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
  const hideAndClear = () => {
    cancel();
    root.setAttribute("data-restoring", "true");
    clearFields();
    reset();
  };
  const restore = () => {
    if (restoreTab?.()) {
      cancel();
      root.removeAttribute("data-restoring");
      return;
    }
    hideAndClear();
    timer = setTimeout(() => {
      clearFields();
      frame = requestAnimationFrame(() => {
        clearFields();
        root.removeAttribute("data-restoring");
      });
    }, 0);
  };
  window.addEventListener("pagehide", hideAndClear);
  window.addEventListener("pageshow", restore);
  window.addEventListener("popstate", restore);
  restore();
  return () => {
    cancel();
    window.removeEventListener("pagehide", hideAndClear);
    window.removeEventListener("pageshow", restore);
    window.removeEventListener("popstate", restore);
    root.removeAttribute("data-restoring");
  };
}
