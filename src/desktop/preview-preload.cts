// Runs before generated scripts, in Electron's isolated preload world. No IPC or Node bridge.
const state = {
  enabled: false,
  selected: null as null | {
    id: string;
    tag: string;
    text: string;
    page: string;
  },
  highlighted: null as HTMLElement | null,
  outline: "",
};
const pending: NonNullable<typeof state.selected>[] = [];
const targets = () => [
  ...document.querySelectorAll<HTMLElement>("[data-produck-id]"),
];
const find = (id: string) => {
  const matches = targets().filter((el) => el.dataset.produckId === id);
  return matches.length === 1 ? matches[0] : null;
};
function clearHighlight() {
  if (state.highlighted) state.highlighted.style.outline = state.outline;
  state.highlighted = null;
}
for (const type of [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "touchstart",
  "touchend",
  "dblclick",
  "contextmenu",
  "submit",
  "keydown",
]) {
  window.addEventListener(
    type,
    (e) => {
      if (state.enabled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { capture: true, passive: false },
  );
}
window.addEventListener(
  "click",
  (e) => {
    if (!state.enabled) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    clearHighlight();
    const target =
      e.target instanceof Element
        ? e.target.closest<HTMLElement>("[data-produck-id]")
        : null;
    state.selected =
      target && find(target.dataset.produckId!) === target
        ? {
            id: target.dataset.produckId!,
            tag: target.tagName,
            text: (target.innerText ?? target.textContent ?? "").slice(0, 800),
            page: document.title,
          }
        : null;
    if (state.selected && pending.length < 100) pending.push(state.selected);
    if (target) {
      state.highlighted = target;
      state.outline = target.style.outline;
      target.style.outline = "2px solid #9a6529";
    }
  },
  true,
);
const api = {
  mode(enabled: boolean) {
    state.enabled = enabled;
    if (!enabled) clearHighlight();
  },
  selection() {
    return state.selected;
  },
  takeSelections() {
    return pending.splice(0);
  },
  capture() {
    return {
      scroll: { x: scrollX, y: scrollY },
      elements: targets()
        .slice(0, 1500)
        .flatMap((el) => {
          const id = el.dataset.produckId!;
          if (
            el instanceof HTMLInputElement &&
            ["password", "file", "hidden"].includes(el.type)
          )
            return [];
          const base = {
            id,
            tag: el.tagName,
            type: el instanceof HTMLInputElement ? el.type : "",
            scrollTop: el.scrollTop,
            scrollLeft: el.scrollLeft,
          };
          if (el instanceof HTMLInputElement)
            return [
              { ...base, value: el.value.slice(0, 10000), checked: el.checked },
            ];
          if (
            el instanceof HTMLTextAreaElement ||
            el instanceof HTMLSelectElement
          )
            return [{ ...base, value: el.value.slice(0, 10000) }];
          if (
            el instanceof HTMLDialogElement ||
            el instanceof HTMLDetailsElement
          )
            return [{ ...base, open: el.open }];
          return el.scrollTop || el.scrollLeft ? [base] : [];
        }),
    };
  },
  restore(saved: any) {
    let restored = 0,
      skipped = 0;
    for (const entry of saved.elements ?? []) {
      const el = find(entry.id);
      if (!el || el.tagName !== entry.tag) {
        skipped++;
        continue;
      }
      if (
        el instanceof HTMLInputElement &&
        (["password", "file", "hidden"].includes(el.type) ||
          entry.type !== el.type)
      ) {
        skipped++;
        continue;
      }
      if (
        (el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement) &&
        typeof entry.value === "string"
      ) {
        el.value = entry.value;
        if (
          el instanceof HTMLInputElement &&
          typeof entry.checked === "boolean"
        )
          el.checked = entry.checked;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (el instanceof HTMLDialogElement && typeof entry.open === "boolean") {
        if (entry.open && !el.open) el.showModal();
        else if (!entry.open && el.open) el.close();
      }
      if (el instanceof HTMLDetailsElement && typeof entry.open === "boolean")
        el.open = entry.open;
      el.scrollTop = entry.scrollTop ?? 0;
      el.scrollLeft = entry.scrollLeft ?? 0;
      restored++;
    }
    scrollTo(saved.scroll?.x ?? 0, saved.scroll?.y ?? 0);
    return { restored, skipped };
  },
};
Object.defineProperty(globalThis, "__produckPreview", {
  value: api,
  writable: false,
});
