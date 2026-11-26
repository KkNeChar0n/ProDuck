import { test } from "node:test";
import assert from "node:assert/strict";
import { discoveryProgress } from "../src/discovery/progress.js";
import { contextJson } from "../src/discovery/context.js";
import type { DiscoveryRun } from "../src/contracts/discovery.js";
test("dynamic progress counts only evidenced complete goals, old templates never become percentages", () => {
  const run = {
    captureIds: ["a"],
    sources: [],
    steps: [],
    budget: 5,
    modules: [
      {
        name: "客户",
        state: "partial",
        markdown: "旧摘要",
        evidenceIds: ["a"],
      },
    ],
    coverage: [
      {
        module: "客户",
        flow: "create",
        checks: ["entry", "fields", "validation", "cancel", "save"],
        evidenceIds: ["a"],
        detail: "",
        limitation: "仍有缺口",
      },
    ],
  } as DiscoveryRun;
  assert.equal(discoveryProgress(run).total, 0);
  run.features = [
    {
      module: "客户",
      name: "按名称筛选",
      goal: "核对匹配列表",
      state: "verified",
      result: "匹配结果",
      remaining: "",
      blocker: "",
      nextAction: "",
      requiresWrite: false,
      evidenceIds: ["a"],
      sourceIds: [],
    },
    {
      module: "客户",
      name: "导入重复数据",
      goal: "重复数据提示",
      state: "blocked",
      result: "",
      remaining: "未导入",
      blocker: "缺测试文件",
      nextAction: "准备样本",
      requiresWrite: true,
      evidenceIds: ["a"],
      sourceIds: [],
    },
  ];
  assert.equal(discoveryProgress(run).percent, 50);
  assert.equal(discoveryProgress(run).budgetPercent, 20);
  run.features[0].remaining = "还有分支";
  assert.equal(discoveryProgress(run).percent, 0);
  run.features[0].remaining = "";
  run.features[0].evidenceIds = ["invented"];
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
