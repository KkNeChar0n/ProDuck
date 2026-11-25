import { test } from "node:test";
import assert from "node:assert/strict";
import { discoveryProgress } from "../src/discovery/progress.js";
import { contextJson } from "../src/discovery/context.js";
import type { DiscoveryRun } from "../src/contracts/discovery.js";
test("verification, summary and budget percentages are independent; skipped or unreferenced checks stay incomplete", () => {
  const run = {
    captureIds: ["a"],
    budget: 5,
    roundStart: 0,
    modules: [
      {
        name: "客户",
        state: "partial",
        signature: "s",
        markdown: "",
        evidenceIds: ["a"],
      },
      { name: "订单", state: "pending", markdown: "", evidenceIds: [] },
    ],
    coverage: [
      {
        module: "客户",
        flow: "create",
        checks: ["entry", "fields", "validation", "cancel"],
        evidenceIds: ["a"],
        limitation: "用户跳过保存",
        detail: "",
      },
    ],
  } as DiscoveryRun;
  const p = discoveryProgress(run);
  assert.equal(p.percent, 20);
  assert.equal(p.budgetPercent, 20);
  assert.equal(p.modules[0].percent, 40);
  assert.equal(p.modules[0].flows[0].percent, 80);
  assert.equal(p.modules[0].flows[0].checks[4].percent, 0);
  assert.equal(p.modules[0].summaryPercent, 100);
  assert.equal(p.modules[1].summaryPercent, 0);
  run.coverage![0].evidenceIds = ["invented"];
  assert.equal(discoveryProgress(run).percent, 0);
});
test("context budget preserves valid JSON, immutable evidence and original element indexes", () => {
  const value = {
    elements: Array.from({ length: 220 }, (_, i) => ({
      index: i,
      label: "长字段".repeat(500),
      id: `element-${i}`,
      form: { key: "path".repeat(100), submitLabels: ["保存"] },
    })),
    text: "正文".repeat(50000),
  };
  const original = JSON.stringify(value);
  const output = contextJson(value, 16000);
  assert(output.length <= 16000);
  const parsed = JSON.parse(output);
  assert(parsed.elements.length > 0);
  assert(
    parsed.elements.every(
      (e: { index: number; id: string }) => e.id === `element-${e.index}`,
    ),
  );
  assert.equal(JSON.stringify(value), original);
  assert.equal(
    contextJson({ id: "abc", text: "short" }),
    '{"id":"abc","text":"short"}',
  );
});
