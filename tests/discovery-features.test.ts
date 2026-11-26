import { test } from "node:test";
import assert from "node:assert/strict";
import {
  featureMarkdown,
  actionableFeatures,
  updateFeatures,
  verifiedFeature,
} from "../src/discovery/features.js";
import type {
  DiscoveryRun,
  DiscoveryFeature,
} from "../src/contracts/discovery.js";
const fixture = () =>
  ({
    captureIds: ["before", "after"],
    sources: [{ id: "doc" }],
    steps: [],
    modules: [{ name: "画布" }],
    features: [],
  }) as unknown as DiscoveryRun;
const feature = (extra: Partial<DiscoveryFeature> = {}): DiscoveryFeature => ({
  module: "画布",
  name: "节点连线",
  goal: "验证连线方向与保留",
  state: "partial",
  result: "已看到端点",
  remaining: "未核对连线",
  blocker: "",
  nextAction: "连接两个节点并核对",
  requiresWrite: false,
  evidenceIds: ["before"],
  sourceIds: [],
  ...extra,
});
test("dynamic items deduplicate, reject fabricated sources atomically, and reopen with contradictions", () => {
  const run = fixture();
  updateFeatures(run, [feature()]);
  updateFeatures(run, [
    feature({
      state: "verified",
      result: "连线方向正确",
      remaining: "",
      nextAction: "",
      evidenceIds: ["after"],
    }),
  ]);
  assert.equal(run.features!.length, 1);
  assert(verifiedFeature(run, run.features![0]));
  updateFeatures(run, [
    feature({ state: "verified", remaining: "持久化未核对" }),
  ]);
  assert.equal(run.features![0].state, "partial");
  assert.equal(actionableFeatures(run).length, 1);
  const snapshot = JSON.stringify(run.features);
  assert.throws(() =>
    updateFeatures(run, [
      feature({ name: "有效新增" }),
      feature({ name: "编造", evidenceIds: ["foreign"] }),
    ]),
  );
  assert.equal(JSON.stringify(run.features), snapshot);
  updateFeatures(run, [
    feature({
      state: "blocked",
      blocker: "缺节点样本",
      nextAction: "提供样本",
    }),
  ]);
  assert.equal(actionableFeatures(run).length, 0);
});
test("source-only and unmatched write outcomes cannot be verified", () => {
  const run = fixture();
  const completed = feature({
    state: "verified",
    remaining: "",
    nextAction: "",
    result: "已保存",
    requiresWrite: true,
    evidenceIds: ["after"],
  });
  updateFeatures(run, [completed]);
  assert.equal(run.features![0].state, "partial");
  run.steps.push({
    captureId: "before",
    observation: "",
    result: "",
    featureKey: "画布 / 其他功能",
    submitted: true,
    executed: true,
    businessActionKey: "key",
  });
  updateFeatures(run, [completed]);
  assert.equal(run.features![0].state, "partial");
  run.steps[0].featureKey = "画布 / 节点连线";
  updateFeatures(run, [completed]);
  assert.equal(run.features![0].state, "verified");
  updateFeatures(run, [{ ...completed, evidenceIds: ["before"] }]);
  assert.equal(run.features![0].state, "partial");
  updateFeatures(run, [
    feature({
      name: "资料里的导出",
      state: "verified",
      remaining: "",
      nextAction: "",
      evidenceIds: [],
      sourceIds: ["doc"],
    }),
  ]);
  assert.equal(run.features![1].state, "partial");
});

test("large feature report remains bounded without changing full records", () => {
  const run = fixture();
  run.features = Array.from({ length: 240 }, (_, i) =>
    feature({
      name: `功能${i}`,
      goal: "目标".repeat(300),
      result: "结果".repeat(600),
    }),
  );
  const original = JSON.stringify(run.features),
    report = featureMarkdown(run);
  assert(report.length < 14500);
  assert(report.includes("未在此摘要展开"));
  assert.equal(JSON.stringify(run.features), original);
});
