import { prototypeCsp } from "./policy.js";
import {
  parse,
  parseFragment,
  serialize,
  type DefaultTreeAdapterMap,
} from "parse5";
import { createHash, randomUUID } from "node:crypto";
type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const excluded = new Set([
  "html",
  "head",
  "meta",
  "title",
  "link",
  "script",
  "style",
  "base",
  "template",
  "noscript",
]);
const attr = (el: Element, name: string) =>
  el.attrs.find((a) => a.name === name)?.value ?? "";
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,100}$/.test(id);
function elements(node: Node): Element[] {
  const result: Element[] = [];
  const walk = (n: Node) => {
    if ("tagName" in n && excluded.has(n.tagName)) {
      if (n.tagName !== "html" && n.tagName !== "head") return;
    } else if ("tagName" in n) result.push(n);
    if ("childNodes" in n) n.childNodes.forEach(walk);
  };
  walk(node);
  return result;
}
function text(el: Node): string {
  if ("value" in el) return el.value;
  if ("tagName" in el && ["script", "style"].includes(el.tagName)) return "";
  return "childNodes" in el
    ? el.childNodes.map(text).join(" ").replace(/\s+/g, " ").trim()
    : "";
}
function keys(el: Element) {
  const id = attr(el, "id"),
    name = attr(el, "name"),
    label = attr(el, "aria-label");
  return [
    id ? `${el.tagName}:id:${id}` : "",
    name ? `${el.tagName}:name:${name}:${attr(el, "type")}` : "",
    label ? `${el.tagName}:label:${label}` : "",
    `${el.tagName}:text:${text(el).slice(0, 150)}:${attr(el, "type")}`,
  ].filter(Boolean);
}
/** Parse without executing HTML. Never guess a correspondence between ambiguous controls. */
export function normalizePrototype(html: string, baseline?: string): string {
  const doc = parse(html),
    next = elements(doc),
    old = baseline ? elements(parse(baseline)) : [];
  const count = (items: Element[], key: (e: Element) => string) => {
    const m = new Map<string, number>();
    for (const e of items) {
      const k = key(e);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const oldIds = count(old, (e) => attr(e, "data-produck-id")),
    nextIds = count(next, (e) => attr(e, "data-produck-id")),
    used = new Set<string>();
  const matching = new Map<string, Element[]>(),
    incoming = new Map<string, number>();
  for (const e of old)
    for (const key of keys(e))
      matching.set(key, [...(matching.get(key) ?? []), e]);
  for (const e of next)
    for (const key of keys(e)) incoming.set(key, (incoming.get(key) ?? 0) + 1);
  // Reserve explicitly preserved identities before inferring missing ones.
  const assignments = new Map<Element, string>();
  for (const el of next) {
    const id = attr(el, "data-produck-id");
    if (validId(id) && nextIds.get(id) === 1 && (oldIds.get(id) ?? 1) === 1) {
      assignments.set(el, id);
      used.add(id);
    }
  }
  for (const el of next) {
    let id = assignments.get(el);
    if (!id)
      for (const key of keys(el)) {
        const candidates = matching.get(key);
        if (candidates?.length !== 1 || incoming.get(key) !== 1) continue;
        const found = attr(candidates[0], "data-produck-id");
        if (validId(found) && oldIds.get(found) === 1 && !used.has(found)) {
          id = found;
          break;
        }
      }
    if (!id) id = `pd-${randomUUID()}`;
    used.add(id);
    el.attrs = el.attrs.filter((a) => a.name !== "data-produck-id");
    el.attrs.push({ name: "data-produck-id", value: id });
  }
  const inspect = (node: Node) => {
    if ("tagName" in node) {
      for (const a of node.attrs) {
        if (
          ["src", "href", "poster", "action"].includes(a.name) &&
          a.value &&
          !a.value.startsWith("#") &&
          !a.value.startsWith("data:")
        )
          throw new Error(
            "原型包含外部或未固定的资源/跳转，请使用内联内容或 data 素材",
          );
        if (a.name === "srcset")
          throw new Error("原型素材请使用单一内嵌 src，不支持外部 srcset");
      }
      const css =
        node.tagName === "style"
          ? node.childNodes.map((n) => ("value" in n ? n.value : "")).join("")
          : attr(node, "style");
      if (
        /@import/i.test(css) ||
        [...css.matchAll(/url\(\s*["']?([^)'"\s]+)/gi)].some(
          (m) => !m[1].startsWith("data:") && !m[1].startsWith("#"),
        )
      )
        throw new Error("原型样式含未固定的外部素材");
    }
    if ("childNodes" in node) node.childNodes.forEach(inspect);
  };
  inspect(doc);
  const htmlNode = doc.childNodes.find(
    (n) => "tagName" in n && n.tagName === "html",
  ) as Element;
  const head = htmlNode.childNodes.find(
    (n) => "tagName" in n && n.tagName === "head",
  ) as Element;
  head.childNodes = head.childNodes.filter(
    (n) =>
      !(
        "tagName" in n &&
        n.tagName === "meta" &&
        ["content-security-policy", "refresh"].includes(
          attr(n, "http-equiv").toLowerCase(),
        )
      ),
  );
  const policy = parseFragment(
    `<meta http-equiv="Content-Security-Policy" content="${prototypeCsp}">`,
  ).childNodes[0] as Element;
  policy.parentNode = head;
  head.childNodes.unshift(policy);
  return serialize(doc);
}
export function prototypeChanges(before: string, after: string) {
  const index = (html: string) =>
    new Map(
      elements(parse(html))
        .map((el) => [
          attr(el, "data-produck-id"),
          {
            id: attr(el, "data-produck-id"),
            label: (
              attr(el, "aria-label") ||
              attr(el, "id") ||
              text(el) ||
              el.tagName
            ).slice(0, 100),
            signature: createHash("sha256")
              .update(serialize(el) + JSON.stringify(el.attrs))
              .digest("hex"),
          },
        ])
        .filter(([id]) => Boolean(id)) as [
        string,
        { id: string; label: string; signature: string },
      ][],
    );
  const a = index(before),
    b = index(after);
  return {
    added: [...b.values()]
      .filter((v) => !a.has(v.id))
      .map((v) => ({ id: v.id, label: v.label })),
    removed: [...a.values()]
      .filter((v) => !b.has(v.id))
      .map((v) => ({ id: v.id, label: v.label })),
    changed: [...b.values()]
      .filter((v) => a.has(v.id) && a.get(v.id)!.signature !== v.signature)
      .map((v) => ({ id: v.id, label: v.label })),
    sourceChanged: before !== after,
  };
}
