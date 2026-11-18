import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryTools } from "../src/agent/delivery-tools.js";
import type { ToolContext } from "../src/agent/tools.js";
const ctx: ToolContext = {
  projectId: "project",
  runId: "run",
  stepId: "step",
  signal: new AbortController().signal,
};
function fixture() {
  const calls: unknown[][] = [];
  const snapshot = {
    id: "snapshot",
    runId: "pub",
    title: "文档",
    sections: [{ id: "section", title: "目标", editable: true, text: "原文" }],
  };
  const tools = deliveryTools(
    {
      list: () => [],
      prepare: async (...args) => {
        calls.push(["publication", ...args]);
        return {
          id: "review",
          draftId: "draft",
          status: "prepared",
          parent: { title: "迭代" },
        } as any;
      },
    },
    { list: () => [] },
    {
      snapshots: () => [snapshot as any],
      fetch: async (...args) => {
        calls.push(["fetch", ...args]);
        return snapshot as any;
      },
      prepare: (...args) => {
        calls.push(["change", ...args]);
        return { id: "change", title: "目标", state: "pending" } as any;
      },
    },
    {
      list: () => [],
      prepare: async (...args) => {
        calls.push(["sync", ...args]);
        return { state: "prepared" } as any;
      },
    },
  );
  return {
    tools,
    calls,
    snapshot,
    run: (name: string, args: Record<string, string>) =>
      tools.find((t) => t.description.name === name)!.run(ctx, args),
  };
}
test("delivery tools expose preparation only, route all actions through host project", async () => {
  const f = fixture();
  assert.deepEqual(
    f.tools
      .filter((t) => t.description.approval)
      .map((t) => t.description.name),
    [
      "prepare_publication",
      "fetch_published_prd",
      "prepare_prd_change",
      "prepare_yunxiao_sync",
    ],
  );
  assert(
    !f.tools.some((t) =>
      /^(approve|publish|merge|execute)/.test(t.description.name),
    ),
  );
  await f.run("prepare_publication", { draftId: "draft" });
  await f.run("fetch_published_prd", { publicationId: "pub" });
  await f.run("prepare_yunxiao_sync", { publicationId: "pub", itemId: "item" });
  assert.deepEqual(f.calls, [
    ["publication", "project", "draft"],
    ["fetch", "project", "pub"],
    ["sync", "project", "pub", "item"],
  ]);
  const result: any = await f.run("prepare_prd_change", {
    snapshotId: "snapshot",
    sectionId: "section",
    after: "",
  });
  assert.equal(result.state, "pending");
  assert.deepEqual(f.calls.at(-1), [
    "change",
    "project",
    "snapshot",
    "section",
    "",
  ]);
});
test("section tools refuse foreign snapshots and replacement of truncated content", async () => {
  const f = fixture();
  assert.throws(
    () =>
      f.run("read_prd_section", {
        snapshotId: "foreign",
        sectionId: "section",
      }),
    /不属于/,
  );
  f.snapshot.sections[0].text = "a".repeat(17000);
  const section: any = await f.run("read_prd_section", {
    snapshotId: "snapshot",
    sectionId: "section",
  });
  assert.equal(section.truncated, true);
  assert.equal(section.text.length, 16000);
  assert.throws(
    () =>
      f.run("prepare_prd_change", {
        snapshotId: "snapshot",
        sectionId: "section",
        after: "replace",
      }),
    /过长/,
  );
  assert.equal(f.calls.length, 0);
});
