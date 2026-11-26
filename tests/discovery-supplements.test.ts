import { test } from "node:test";
import assert from "node:assert/strict";
import {
  overviewCounts,
  supplementNeeds,
} from "../src/discovery/supplements.js";
import type { DiscoveryRun } from "../src/contracts/discovery.js";
test("steps and remaining budget are distinct from modules and stable supplement identities", () => {
  const run = {
    roundSteps: 4,
    roundStart: 20,
    budget: 36,
    captureIds: Array(26).fill("x"),
    steps: [{ module: "A" }],
    modules: [
      { name: "A", markdown: "已整理", captureNotes: ["缺画布", "缺画布"] },
      { name: "B", markdown: "" },
    ],
  } as DiscoveryRun;
  const counts = overviewCounts(run);
  assert.equal(counts.used, 4);
  assert.equal(counts.remaining, 12);
  assert.equal(counts.uncollected, 1);
  assert.equal(counts.needs, 2);
  const needs = supplementNeeds(run);
  run.supplementPlan = needs;
  run.supplements = [
    {
      needId: needs[0].id,
      module: "A",
      captureId: "supplement",
      description: "画布",
    },
  ];
  assert.equal(supplementNeeds(run)[0].captureId, "supplement");
  assert.equal(overviewCounts(run).needs, 1);
  assert.equal(overviewCounts(run).used, 4);
});
