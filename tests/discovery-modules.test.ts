import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensureDiscoveryModule,
  modulePlan,
  summarizeModule,
  preserveModuleProgress,
  moduleMarkdown,
} from "../src/discovery/modules.js";
import type { DiscoveryRun } from "../src/contracts/discovery.js";
const fixture = (): DiscoveryRun => ({
  id: "run",
  projectId: "p",
  releaseId: "r",
  url: "https://example.com",
  goal: "",
  budget: 40,
  state: "running",
  message: "",
  createdAt: "now",
  captureIds: ["a", "b"],
  steps: [
    {
      module: "客户",
      captureId: "a",
      observation: "客户筛选",
      result: "已观察",
    },
    {
      module: "订单",
      captureId: "b",
      observation: "订单列表",
      result: "已观察",
    },
  ],
  sources: [],
});
const signal = () => new AbortController().signal;
const capture = (id: string) => ({ title: id, text: "页面依据" });
test("module summaries are evidence scoped, cached and kept separate from unvisited plans", async () => {
  const run = fixture();
  modulePlan(run, ["客户", "订单", "报表"]);
  let calls = 0;
  const model = async (prompt: string) => {
    calls++;
    const data = JSON.parse(prompt.split("模块资料：")[1]);
    assert.deepEqual(
      data.evidence.map((e: { id: string }) => e.id),
      ["a"],
    );
    assert(!prompt.includes("订单列表"));
    return JSON.stringify({
      understanding: "客户筛选职责",
      flows: ["输入→查询→结果"],
      unknowns: ["权限未覆盖"],
      evidenceIds: ["a"],
    });
  };
  await summarizeModule(run, "客户", signal(), model, () => {}, capture);
  await summarizeModule(run, "客户", signal(), model, () => {}, capture);
  assert.equal(calls, 1);
  assert.equal(run.modules![0].state, "partial");
  assert.equal(run.modules![2].state, "pending");
  assert.match(moduleMarkdown(run), /尚未探索/);
  run.steps.push({
    module: "客户",
    captureId: "a",
    observation: "补充详情",
    result: "已观察",
  });
  await summarizeModule(run, "客户", signal(), model, () => {}, capture);
  assert.equal(calls, 2);
});
test("foreign module citations fail safely and retry retains local observations", async () => {
  const run = fixture();
  await summarizeModule(
    run,
    "客户",
    signal(),
    async () =>
      JSON.stringify({
        understanding: "错误引用",
        flows: [],
        unknowns: [],
        evidenceIds: ["b"],
      }),
    () => {},
    capture,
  );
  const row = run.modules![0];
  assert.equal(row.state, "failed");
  assert.match(row.markdown, /客户筛选/);
  assert.match(row.error!, /当前模块依据/);
  await summarizeModule(
    run,
    "客户",
    signal(),
    async () =>
      JSON.stringify({
        understanding: "恢复后整理",
        flows: [],
        unknowns: [],
        evidenceIds: ["a"],
      }),
    () => {},
    capture,
  );
  assert.equal(row.state, "partial");
  assert.equal(row.error, undefined);
  assert.match(row.markdown, /恢复后整理/);
});
test("interruption creates local module checkpoints and preserves existing successful summaries", async () => {
  const run = fixture();
  await summarizeModule(
    run,
    "客户",
    signal(),
    async () =>
      JSON.stringify({
        understanding: "已有总结",
        flows: [],
        unknowns: [],
        evidenceIds: ["a"],
      }),
    () => {},
    capture,
  );
  const markdown = run.modules![0].markdown;
  preserveModuleProgress(run);
  assert.equal(run.modules![0].markdown, markdown);
  assert.equal(run.modules![1].state, "partial");
  assert.match(run.modules![1].markdown, /订单列表/);
  assert(run.modules![1].error);
  assert.throws(() => modulePlan(run, [""]), /模块计划/);
  ensureDiscoveryModule(run, "报表");
  assert.equal(run.modules![2].state, "pending");
});

test("checkpoint recovery remains readable if observed modules exceed a full plan", () => {
  const run = fixture();
  modulePlan(
    run,
    Array.from({ length: 12 }, (_, i) => `planned-${i}`),
  );
  assert.doesNotThrow(() => preserveModuleProgress(run));
  assert.equal(run.modules!.length, 12);
  assert.equal(run.steps.length, 2);
});
