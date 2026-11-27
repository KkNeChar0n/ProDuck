import {
  parse,
  parseFragment,
  serialize,
  serializeOuter,
  type DefaultTreeAdapterMap,
} from "parse5";
import type { Capture } from "../contracts/workbench.js";
type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const attrs = (n: Element, name: string) =>
  n.attrs.find((a) => a.name === name)?.value ?? "";
const kids = (n: Node) => ("childNodes" in n ? n.childNodes : []);
const getStyle = (n: Element) =>
  new Map(
    attrs(n, "style")
      .split(";")
      .map((s) => {
        const i = s.indexOf(":");
        return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
      }),
  );
function setStyle(n: Element, values: Record<string, string>) {
  const styles = getStyle(n);
  for (const [k, v] of Object.entries(values)) styles.set(k, v);
  n.attrs = n.attrs.filter((a) => a.name !== "style");
  n.attrs.push({
    name: "style",
    value: [...styles].map(([k, v]) => `${k}:${v}`).join(";"),
  });
}
const layoutProperties =
  /^(?:display|position|top|right|bottom|left|inset|flex(?:-direction|-wrap|-grow|-shrink|-basis)?|order|grid(?:-template-columns|-template-rows|-column|-row|-area|-auto-flow)?|gap|row-gap|column-gap|align-items|align-self|justify-content|justify-self|width|height|min-width|max-width|min-height|max-height|padding(?:-left|-right|-top|-bottom)?|margin(?:-left|-right|-top|-bottom)?|box-sizing|overflow(?:-x|-y)?|background(?:-color)?|color|border(?:-radius)?|font(?:-family|-size|-weight)?|line-height|text-align|box-shadow|z-index)$/;
const containers = new Set([
  "body",
  "div",
  "main",
  "section",
  "aside",
  "nav",
  "header",
  "footer",
  "article",
  "form",
]);
export interface RegionPlan {
  version: 1;
  template: string;
  parts: { id: string; input: string }[];
}
/** Keep parent layout in the host; model outputs occupy typed DOM slots, not a flat list. */
export function planRegions(
  capture: Pick<Capture, "html" | "text" | "structure">,
  limit = 10000,
  prefix = "region",
): RegionPlan {
  const doc = parse(
    capture.html ||
      `<html><body><pre>${escape(capture.text + "\n" + capture.structure)}</pre></body></html>`,
  );
  function clean(n: Node, inherited = new Map<string, string>()) {
    let nextInherited = inherited;
    if ("tagName" in n) {
      n.attrs = n.attrs.filter((a) =>
        [
          "id",
          "class",
          "style",
          "role",
          "type",
          "placeholder",
          "aria-label",
          "title",
          "alt",
          "value",
          "colspan",
          "rowspan",
        ].includes(a.name),
      );
      const original = getStyle(n);
      nextInherited = new Map(inherited);
      for (const [k, v] of original)
        if (
          /^(?:color|font-family|font-size|font-weight|line-height|text-align)$/.test(
            k,
          )
        )
          nextInherited.set(k, v);
      const styles = [...original].filter(
        ([k, v]) =>
          layoutProperties.test(k) &&
          !(
            /^(?:color|font-family|font-size|font-weight|line-height|text-align)$/.test(
              k,
            ) && inherited.get(k) === v
          ) &&
          !(v === "normal" || (v === "none" && k !== "display")) &&
          !(k === "border" && /^0px none/.test(v)) &&
          !/(?:url\s*\(|expression\s*\(|javascript:)/i.test(v),
      );
      n.attrs = n.attrs.filter((a) => a.name !== "style");
      n.attrs.push({
        name: "style",
        value: styles.map(([k, v]) => `${k}:${v}`).join(";"),
      });
    }
    if ("childNodes" in n) {
      n.childNodes = n.childNodes.filter(
        (c) =>
          !(
            "tagName" in c &&
            [
              "script",
              "style",
              "link",
              "meta",
              "iframe",
              "object",
              "embed",
              "base",
            ].includes(c.tagName)
          ),
      );
      n.childNodes.forEach((c) => clean(c, nextInherited));
    }
  }
  clean(doc);
  let body: Element | undefined;
  function find(n: Node) {
    if ("tagName" in n && n.tagName === "body") body = n;
    else kids(n).forEach(find);
  }
  find(doc);
  if (!body) throw new Error("页面缺少body");
  function normalize(n: Node) {
    if ("tagName" in n) {
      if (containers.has(n.tagName))
        setStyle(n, { "max-width": "100%", "box-sizing": "border-box" });
      const elements = kids(n).filter((c): c is Element => "tagName" in c),
        side = elements.find((c) => c.tagName === "aside"),
        main = elements.find((c) => c.tagName === "main"),
        header = elements.find((c) => c.tagName === "header");
      // Older captures lack fixed offsets. Recognizable application shells become responsive grids.
      if (side && main) {
        const width = getStyle(side).get("width");
        setStyle(n, {
          display: "grid",
          "grid-template-columns": `${width && /^\d+(?:\.\d+)?px$/.test(width) ? width : "240px"} minmax(0,1fr)`,
          "grid-template-rows": header ? "auto minmax(0,1fr)" : "minmax(0,1fr)",
          width: "100%",
          "min-width": "0",
          height: "auto",
          "min-height": "100vh",
          overflow: "visible",
        });
        for (const el of [side, main, ...(header ? [header] : [])])
          setStyle(el, {
            position: "relative",
            top: "auto",
            right: "auto",
            bottom: "auto",
            left: "auto",
            margin: "0",
            width: "auto",
            height: "auto",
            "min-width": "0",
            "box-sizing": "border-box",
          });
        setStyle(side, {
          "grid-column": "1",
          "grid-row": header ? "1 / span 2" : "1",
        });
        setStyle(main, { "grid-column": "2", "grid-row": header ? "2" : "1" });
        if (header) setStyle(header, { "grid-column": "2", "grid-row": "1" });
      }
      // Captured root sizes are viewport pixels, not fixed desktop requirements.
      if (n === body || n.parentNode === body)
        setStyle(n, {
          width: "100%",
          "max-width": "100%",
          "min-width": "0",
          height: "auto",
          "min-height": "100%",
          overflow: "visible",
          "box-sizing": "border-box",
        });
    }
    kids(n).forEach(normalize);
  }
  normalize(body);
  const parts: RegionPlan["parts"] = [];
  function boundedInput(n: Node): string {
    let input =
      "tagName" in n ? serializeOuter(n) : "value" in n ? escape(n.value) : "";
    if (JSON.stringify(input).length <= limit) return input;
    // Repeated table rows and giant leaves are presentation samples, not an unbounded dataset.
    const copy = parseFragment(input);
    let textBudget = Math.max(100, Math.floor(limit / 8));
    function reduce(x: Node) {
      if ("value" in x) {
        x.value = x.value.slice(0, Math.min(300, textBudget));
        textBudget -= x.value.length;
      }
      if ("tagName" in x)
        x.attrs = x.attrs.filter((a) =>
          ["role", "type", "colspan", "rowspan"].includes(a.name),
        );
      if ("childNodes" in x) {
        if (
          "tagName" in x &&
          ["tbody", "thead", "ul", "ol"].includes(x.tagName)
        )
          x.childNodes = x.childNodes.slice(0, 5);
        x.childNodes.forEach(reduce);
      }
    }
    reduce(copy);
    input = serialize(copy);
    if (JSON.stringify(input).length > limit) {
      let text = "";
      function collect(x: Node) {
        if ("value" in x) text += x.value + " ";
        kids(x).forEach(collect);
      }
      collect(copy);
      input = `<div>复杂区域摘要（重复数据已省略）：${escape(text.slice(0, Math.floor(limit / 12)))}</div>`;
    }
    return input;
  }
  function visitChildren(n: Node): string {
    const style = "tagName" in n ? getStyle(n) : new Map<string, string>();
    const column =
      style.get("display") === "flex" &&
      style.get("flex-direction") === "column";
    const stack =
      !style.get("display") || style.get("display") === "block" || column;
    if (
      !stack ||
      kids(n).some(
        (c) =>
          "tagName" in c && ["aside", "header", "main"].includes(c.tagName),
      )
    )
      return kids(n).map(visit).join("");
    let result = "",
      group: Node[] = [],
      length = 0;
    const flush = () => {
      if (group.length === 1) result += visit(group[0]);
      else if (group.length) {
        const id = `${prefix}-${parts.length + 1}`;
        const groupStyle = column
          ? `display:flex;flex-direction:column;gap:${style.get("gap") || "0"}`
          : "display:block";
        const input = `<div style="${groupStyle}">${group.map((c) => ("tagName" in c ? serializeOuter(c) : "value" in c ? escape(c.value) : "")).join("")}</div>`;
        parts.push({ id, input });
        result += `<div data-produck-slot="${id}" style="${groupStyle};min-width:0"></div>`;
      }
      group = [];
      length = 0;
    };
    for (const child of kids(n)) {
      if ("value" in child && !child.value.trim()) continue;
      const html =
        "tagName" in child
          ? serializeOuter(child)
          : "value" in child
            ? escape(child.value)
            : "";
      const size = JSON.stringify(html).length;
      if (size > limit - 300) {
        flush();
        result += visit(child);
        continue;
      }
      if (length + size > limit - 300) flush();
      group.push(child);
      length += size;
    }
    flush();
    return result;
  }
  function visit(n: Node): string {
    if ("value" in n && !n.value.trim()) return "";
    if (!("tagName" in n) && !("value" in n)) return "";
    const input = "tagName" in n ? serializeOuter(n) : escape(n.value);
    const elements = kids(n).filter((c) => "tagName" in c);
    const style = "tagName" in n ? getStyle(n) : new Map();
    const hasLayout =
      elements.length > 1 &&
      (("parentNode" in n &&
        n.parentNode === body &&
        ["flex", "grid", "inline-flex", "inline-grid"].includes(
          style.get("display") ?? "",
        )) ||
        elements.some(
          (c) =>
            "tagName" in c && ["aside", "main", "header"].includes(c.tagName),
        ));
    if (
      "tagName" in n &&
      containers.has(n.tagName) &&
      kids(n).length &&
      (JSON.stringify(input).length > limit || hasLayout)
    ) {
      const original = n.childNodes;
      n.childNodes = [];
      const outer = serializeOuter(n);
      n.childNodes = original;
      const at = outer.lastIndexOf("</");
      return outer.slice(0, at) + visitChildren(n) + outer.slice(at);
    }
    const id = `${prefix}-${parts.length + 1}`;
    parts.push({ id, input: boundedInput(n) });
    // Preserve the source element as a layout box; only the region's inner contents are generated.
    const styleText = "tagName" in n ? attrs(n, "style") : "";
    return `<div data-produck-slot="${id}" style="${escape(styleText)};min-width:0;box-sizing:border-box"> </div>`;
  }
  const template = `<div data-produck-layout="1" style="width:100%;min-width:0">${visitChildren(body)}</div>`;
  if (!parts.length) {
    parts.push({ id: `${prefix}-1`, input: "<p>页面暂无可读取内容</p>" });
    return {
      version: 1,
      template: `<div data-produck-slot="${prefix}-1"></div>`,
      parts,
    };
  }
  return { version: 1, template, parts };
}
export function fillRegionSlots(
  template: string,
  fragments: Record<string, string>,
): string {
  const doc = parseFragment(template);
  const seen = new Set<string>();
  function fill(n: Node) {
    if ("tagName" in n) {
      const id = attrs(n, "data-produck-slot");
      if (id && Object.hasOwn(fragments, id)) {
        const fragment = parseFragment(fragments[id]);
        n.childNodes = fragment.childNodes;
        for (const c of n.childNodes) c.parentNode = n;
        seen.add(id);
        return;
      }
    }
    kids(n).forEach(fill);
  }
  fill(doc);
  for (const id of Object.keys(fragments))
    if (!seen.has(id)) throw new Error(`区域布局插槽不存在：${id}`);
  return serialize(doc);
}
