import { test } from "node:test";
import assert from "node:assert/strict";
import { performDrag, type DragData } from "../src/discovery/drag.js";
import {
  actionConfirmation,
  businessActionIdentity,
  validateDiscoveryAction,
} from "../src/discovery/browser-policy.js";
import type {
  DiscoveryPage,
  DiscoveryAction,
} from "../src/contracts/discovery.js";
const page: DiscoveryPage = {
  title: "画布",
  url: "https://example.com",
  text: "",
  structure: "",
  fingerprint: "x",
  blocked: [],
  elements: [
    { index: 0, key: "#a", tag: "DIV", role: "", label: "资源", type: "" },
    { index: 1, key: "#b", tag: "CANVAS", role: "", label: "画布", type: "" },
  ],
};
const action: DiscoveryAction = { kind: "drag", index: 0, targetIndex: 1 };
test("drag validates both indexes and normalized points; defaults require confirmation and stable replay identity", () => {
  validateDiscoveryAction(page, action, page.url);
  assert(actionConfirmation(page, action));
  assert.equal(actionConfirmation(page, { ...action, effect: "read" }), null);
  for (const invalid of [
    { targetIndex: 2 },
    { to: { x: NaN, y: 0.5 } },
    { from: { x: 2, y: 0 } },
    { to: { x: 0, y: Infinity } },
  ])
    assert.throws(() =>
      validateDiscoveryAction(page, { ...action, ...invalid }, page.url),
    );
  assert.equal(
    businessActionIdentity(page, action),
    businessActionIdentity(page, { ...action, to: { x: 0.2, y: 0.7 } }),
  );
  assert.notEqual(
    businessActionIdentity(page, action),
    businessActionIdentity(page, { ...action, targetIndex: 0 }),
  );
});
test("cancelled drag releases mouse and disables interception without issuing drop", async () => {
  const controller = new AbortController(),
    calls: { method: string; params: Record<string, unknown> }[] = [];
  const data: DragData = {
    items: [{ mimeType: "text/plain", data: "resource" }],
    dragOperationsMask: 1,
  };
  await assert.rejects(
    performDrag(
      async (method, params) => {
        calls.push({ method, params });
        if (params.type === "dragOver") controller.abort();
      },
      () => data,
      { x: 10, y: 10 },
      { x: 100, y: 100 },
      controller.signal,
    ),
  );
  assert(!calls.some((c) => c.params.type === "drop"));
  assert(calls.some((c) => c.params.type === "dragCancel"));
  assert(calls.some((c) => c.params.type === "mouseReleased"));
  assert.deepEqual(calls.at(-1), {
    method: "Input.setInterceptDrags",
    params: { enabled: false },
  });
});
test("failed mouse press also releases the potentially pressed button", async () => {
  const calls: string[] = [];
  await assert.rejects(
    performDrag(
      async (_method, params) => {
        calls.push(String(params.type));
        if (params.type === "mousePressed") throw new Error("transport lost");
      },
      () => undefined,
      { x: 10, y: 10 },
      { x: 100, y: 100 },
      new AbortController().signal,
    ),
    /transport lost/,
  );
  assert(calls.includes("mouseReleased"));
});

test("interception enable failure still attempts to restore ordinary input", async () => {
  const flags: unknown[] = [];
  await assert.rejects(
    performDrag(
      async (_method, params) => {
        flags.push(params.enabled);
        if (params.enabled) throw new Error("lost enable response");
      },
      () => undefined,
      { x: 10, y: 10 },
      { x: 100, y: 100 },
      new AbortController().signal,
    ),
    /lost enable response/,
  );
  assert.deepEqual(flags, [true, false]);
});
