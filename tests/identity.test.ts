import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePrototype,
  prototypeChanges,
} from "../src/prototypes/identity.js";
import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
function nodes(html: string) {
  const all: DefaultTreeAdapterMap["element"][] = [];
  const walk = (n: DefaultTreeAdapterMap["node"]) => {
    if ("tagName" in n) all.push(n);
    if ("childNodes" in n) n.childNodes.forEach(walk);
  };
  walk(parse(html));
  return all;
}
const get = (html: string, id: string) =>
  nodes(html)
    .find((n) => n.attrs.some((a) => a.name === "id" && a.value === id))!
    .attrs.find((a) => a.name === "data-produck-id")!.value;
test("identity normalization preserves unique controls through reorder and missing model IDs without executing scripts", () => {
  const before = normalizePrototype(
    '<html><body><input id="query"><button id="save">保存</button><script>throw new Error("must not run")</script></body></html>',
  );
  const after = normalizePrototype(
    '<html><body><button id="save">确认保存</button><input id="query"><select id="status"></select></body></html>',
    before,
  );
  assert.equal(get(before, "save"), get(after, "save"));
  assert.equal(get(before, "query"), get(after, "query"));
  assert.match(before, /must not run/);
  assert.equal(normalizePrototype(before, before), before);
  const diff = prototypeChanges(before, after);
  assert(diff.changed.some((e) => e.id === get(before, "save")));
  assert(diff.added.some((e) => e.id === get(after, "status")));
  const removed = normalizePrototype(
    '<html><body><input id="query"></body></html>',
    before,
  );
  assert(
    prototypeChanges(before, removed).removed.some(
      (e) => e.id === get(before, "save"),
    ),
  );
});
test("duplicate or malformed IDs are repaired; ambiguous controls never receive an inferred old identity", () => {
  const before = normalizePrototype(
    '<html><body><button data-produck-id="same">确认</button><button data-produck-id="same">确认</button><input data-produck-id="bad id"></body></html>',
  );
  const ids = nodes(before).flatMap((n) =>
    n.attrs.filter((a) => a.name === "data-produck-id").map((a) => a.value),
  );
  assert.equal(ids.length, new Set(ids).size);
  assert(ids.every((id) => /^[\w-]+$/.test(id)));
  const after = normalizePrototype(
    "<html><body><button>确认</button><button>确认</button></body></html>",
    before,
  );
  const oldButtons = nodes(before)
    .filter((n) => n.tagName === "button")
    .map((n) => n.attrs.find((a) => a.name === "data-produck-id")!.value);
  assert(
    nodes(after)
      .filter((n) => n.tagName === "button")
      .every(
        (n) =>
          !oldButtons.includes(
            n.attrs.find((a) => a.name === "data-produck-id")!.value,
          ),
      ),
  );
});

test("saved prototypes embed network policy and reject unfixed assets", () => {
  const html = normalizePrototype(
    '<html><head><meta http-equiv="refresh" content="0;url=https://example.com"></head><body>OK</body></html>',
  );
  assert.match(html, /Content-Security-Policy/);
  assert(!html.includes('http-equiv="refresh"'));
  for (const body of [
    '<img src="https://example.com/image.png">',
    '<script src="app.js"></script>',
    "<style>body{background:url(https://example.com/image.png)}</style>",
  ])
    assert.throws(
      () => normalizePrototype(`<html><body>${body}</body></html>`),
      /素材|资源/,
    );
});
