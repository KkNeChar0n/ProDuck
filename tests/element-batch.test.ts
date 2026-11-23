import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateElementBatch } from "../src/prototypes/identity.js";
import { prototypePrompt } from "../src/agent/prototype-generator.js";
const html =
  '<html><body><h1 data-produck-id="title">标题</h1><button data-produck-id="save">保存</button></body></html>';
const batch = {
  baselineId: "v1",
  contentHash: createHash("sha256").update(html).digest("hex"),
  items: [
    { elementId: "title", prompt: "改为客户管理" },
    { elementId: "save", prompt: "改为绿色" },
  ],
};
test("batch preserves distinct target instructions in model context", () => {
  const result = validateElementBatch(batch, "v1", html);
  assert.deepEqual(result, batch);
  const prompt = prototypePrompt(
    { title: "页面", text: "", structure: "", actions: [] },
    "",
    html,
    { batch: result },
  );
  assert(prompt.includes(JSON.stringify({ batch })));
  assert.notEqual(result.items, batch.items);
});
test("batch rejects stale versions, hashes, foreign and ambiguous targets, duplicates and empty prompts", () => {
  assert.throws(() => validateElementBatch(batch, "v2", html));
  assert.throws(() => validateElementBatch(batch, "v1", html + " "));
  assert.throws(() => validateElementBatch(batch, undefined, undefined));
  for (const items of [
    [],
    [...batch.items, batch.items[0]],
    [{ elementId: "foreign", prompt: "改色" }],
    [{ elementId: "title", prompt: " " }],
    [{ elementId: "title", prompt: "x".repeat(2001) }],
    Array(13).fill(batch.items[0]),
  ])
    assert.throws(() => validateElementBatch({ ...batch, items }, "v1", html));
  const ambiguous = html.replace(
    "</body>",
    '<div data-produck-id="title"></div></body>',
  );
  assert.throws(() =>
    validateElementBatch(
      {
        ...batch,
        contentHash: createHash("sha256").update(ambiguous).digest("hex"),
      },
      "v1",
      ambiguous,
    ),
  );
});
