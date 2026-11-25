/** Keep JSON valid and original element indexes; shrink only the transmitted copy. */
export function contextJson(value: unknown, budget = 6000): string {
  const original = JSON.stringify(value);
  if (original.length <= budget) return original;
  for (let level = 0; level < 12; level++) {
    const chars = Math.max(40, Math.floor(800 / 2 ** level));
    const items = Math.max(1, Math.floor(160 / 2 ** Math.max(0, level - 3)));
    const shrink = (v: unknown, key = "", depth = 0): unknown => {
      if (depth > 12) return "[层级过深，已省略]";
      if (typeof v === "string") {
        const preserve =
          /^(id|captureId|evidenceIds|index|name|module|kind|flow|state)$/.test(
            key,
          );
        const limit = preserve ? Math.max(200, chars) : chars;
        return v.length > limit ? v.slice(0, limit) + "…[已截断]" : v;
      }
      if (Array.isArray(v)) {
        const selected =
          v.length > items
            ? [
                ...v.slice(0, Math.ceil(items / 2)),
                ...v.slice(v.length - Math.floor(items / 2)),
              ]
            : v;
        return selected.map((x) => shrink(x, key, depth + 1));
      }
      if (v && typeof v === "object")
        return Object.fromEntries(
          Object.entries(v).map(([k, x]) => [k, shrink(x, k, depth + 1)]),
        );
      return v;
    };
    const reduced = shrink(value);
    const text = JSON.stringify(reduced);
    if (text.length <= budget) return text;
  }
  throw new Error(
    "单项页面结构过大，无法在保留索引的前提下压缩，请缩小当前页面范围。",
  );
}
