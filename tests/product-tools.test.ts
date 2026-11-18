import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openProjectDatabase } from "../src/projects/storage.js";
import { ProjectRepository } from "../src/projects/repository.js";
import { PrototypeRepository } from "../src/prototypes/repository.js";
import { DocumentWorkflow } from "../src/workflows/documents.js";
import { ToolRegistry } from "../src/agent/tools.js";
import { productTools } from "../src/agent/product-tools.js";
import { SkillRepository } from "../src/skills/repository.js";
import type { ModelService } from "../src/agent/model-service.js";
function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), "produck-tools-")),
    db = openProjectDatabase(join(root, "db")),
    projects = new ProjectRepository(db, join(root, "state")),
    p = projects.create("A", root),
    b = projects.create("B", root),
    versions = new PrototypeRepository(db, projects);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  let signal: AbortSignal | undefined,
    modelCalls = 0;
  const docs = new DocumentWorkflow(projects, versions, {
    request: async (_id: string, _prompt: string, s: AbortSignal) => {
      modelCalls++;
      signal = s;
      return await new Promise((_resolve, reject) =>
        s.addEventListener("abort", () => reject(new Error("模型已取消")), {
          once: true,
        }),
      );
    },
  } as unknown as ModelService);
  const tools = new ToolRegistry(
    projects,
    versions,
    {
      context: async () => ({ label: "page", fingerprint: "hash" }),
      open: async () => {},
      capture: async () => {},
      action: async () => {},
    },
    productTools(
      versions,
      {
        generate: async (...args) => {
          signal = args[6];
          return versions.create(args[0], "<html>candidate</html>", [args[1]]);
        },
      },
      docs,
    ),
  );
  const controller = new AbortController(),
    ctx = {
      projectId: p.id,
      runId: randomUUID(),
      stepId: randomUUID(),
      signal: controller.signal,
    };
  return {
    p,
    b,
    projects,
    versions,
    docs,
    tools,
    ctx,
    controller,
    signal: () => signal,
    calls: () => modelCalls,
  };
}
test("product tools enforce scope and authorization without exposing approval or publication tools", async (t) => {
  const f = fixture(t);
  for (const tool of [
    "approve_prototype",
    "publish_prd",
    "merge_prd",
    "read_token",
  ])
    assert.throws(() => f.tools.validate({ tool, args: {} }), /未注册/);
  await assert.rejects(
    f.tools.execute(f.ctx, {
      tool: "generate_prototype",
      args: { captureId: "page" },
    }),
    /批准/,
  );
  await assert.rejects(
    f.tools.execute(f.ctx, {
      tool: "product_artifacts",
      args: { projectId: f.b.id },
    }),
    /越权/,
  );
  const result: any = await f.tools.execute(
    f.ctx,
    { tool: "generate_prototype", args: { captureId: "page" } },
    true,
  );
  assert.equal(result.approved, false);
  assert.equal(f.signal(), f.controller.signal);
  const artifacts: any = await f.tools.execute(
    { ...f.ctx, projectId: f.b.id },
    { tool: "product_artifacts", args: {} },
  );
  assert.equal(artifacts.versions.length, 0);
  await assert.rejects(
    f.tools.execute(f.ctx, { tool: "read_prd", args: { draftId: "foreign" } }),
    /不属于/,
  );
});
test("Agent cannot generate PRD from unapproved or foreign version, malformed screenshot IDs", async (t) => {
  const f = fixture(t),
    v = f.versions.create(f.p.id, "<html>test</html>", []);
  const call = {
    tool: "generate_prd",
    args: { versionId: v.id, stateIds: '["state"]', goal: "写草稿" },
  };
  await assert.rejects(f.tools.execute(f.ctx, call), /批准/);
  await assert.rejects(f.tools.execute(f.ctx, call, true), /先通过/);
  f.versions.approve(f.p.id, v.id);
  await assert.rejects(
    f.tools.execute({ ...f.ctx, projectId: f.b.id }, call, true),
    /不属于/,
  );
  for (const ids of ["{}", "[1]", "[]", "invalid"])
    await assert.rejects(
      f.tools.execute(
        f.ctx,
        { ...call, args: { ...call.args, stateIds: ids } },
        true,
      ),
    );
  assert.equal(f.calls(), 0);
});
test("cancelled Agent propagates cancellation to PRD request and saves no draft", async (t) => {
  const f = fixture(t),
    v = f.versions.create(f.p.id, "<html>test</html>", []);
  f.versions.approve(f.p.id, v.id);
  const state = f.docs.saveState(
    f.p.id,
    v.id,
    "列表",
    "文字",
    new Uint8Array([1]),
  );
  const pending = f.tools.execute(
    f.ctx,
    {
      tool: "generate_prd",
      args: {
        versionId: v.id,
        stateIds: JSON.stringify([state.id]),
        goal: "草稿",
      },
    },
    true,
  );
  assert.equal(f.calls(), 1);
  f.controller.abort();
  await assert.rejects(pending, /取消/);
  assert.equal(f.signal()?.aborted, true);
  assert.equal(f.docs.list(f.p.id).length, 0);
  await assert.rejects(
    f.tools.execute(
      f.ctx,
      { tool: "generate_prototype", args: { captureId: "page" } },
      true,
    ),
    /取消/,
  );
});
test("builtin skills are versioned and selectable without creating imported snapshots", (t) => {
  const f = fixture(t),
    skills = new SkillRepository(f.projects);
  assert.equal(skills.list(f.p.id).length, 0);
  const items = skills.available(f.p.id);
  assert.equal(items.length, 2);
  const first = skills.instructions(f.p.id, "builtin:prd");
  assert.equal(
    first.fingerprint,
    items.find((i) => i.id === "builtin:prd")!.fingerprint,
  );
  assert.match(first.text, /不得声称已经发布/);
  assert.throws(() => skills.instructions("missing", "builtin:prd"));
  assert.equal(skills.list(f.p.id).length, 0);
});
