import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDatabase, atomicWrite } from "../src/projects/storage.js";
import { ProjectRepository } from "./fixtures/legacy-projects.js";
import { PrototypeRepository } from "../src/prototypes/repository.js";
import { PrototypeGenerator } from "../src/agent/prototype-generator.js";
import type { ModelService } from "../src/agent/model-service.js";
import { saveCapture } from "../src/projects/captures.js";

test("restart records interruption; explicit retry keeps original inputs and cannot replay external writes", async () => {
  const root = mkdtempSync(join(tmpdir(), "produck-recovery-")),
    db = openProjectDatabase(join(root, "db"));
  const projects = new ProjectRepository(db, join(root, "state")),
    p = projects.create("A", root),
    other = projects.create("B", root),
    versions = new PrototypeRepository(db, projects);
  const capture = saveCapture(
    p.workspace,
    {
      title: "页面",
      url: "https://example.com/",
      capturedAt: new Date().toISOString(),
      text: "来源",
      structure: "[]",
      actions: [],
    },
    new Uint8Array([1]),
  );
  const baseline = versions.create(
    p.id,
    '<html><body><h1 data-produck-id="title">基线</h1><button data-produck-id="save">保存</button></body></html>',
    [capture.id],
  );
  versions.approve(p.id, baseline.id);
  const batch = {
    baselineId: baseline.id,
    contentHash: baseline.contentHash,
    items: [
      { elementId: "title", prompt: "修改标题" },
      { elementId: "save", prompt: "修改按钮" },
    ],
  };
  const inputRef = "workflows/interrupted-prototype.json";
  atomicWrite(
    join(p.workspace, inputRef),
    JSON.stringify({
      kind: "prototype",
      captureId: capture.id,
      baselineId: baseline.id,
      change: "增加状态筛选",
      edit: { batch },
    }),
  );
  db.prepare(
    "INSERT INTO task_runs(id,project_id,state,created_at,release_id) VALUES(?,?,?,?,?)",
  ).run("interrupted", p.id, "running", new Date().toISOString(), p.id);
  db.prepare("INSERT INTO step_runs VALUES(?,?,?,?,?)").run(
    "step",
    "interrupted",
    "running",
    inputRef,
    null,
  );
  let calls = 0;
  const models = {
    request: async (_id: string, prompt: string) => {
      calls++;
      assert(prompt.includes(JSON.stringify({ batch })));
      assert.match(prompt, /增加状态筛选/);
      assert.match(prompt, /基线/);
      throw new Error("模拟断网");
    },
  } as unknown as ModelService;
  const generator = new PrototypeGenerator(db, projects, models, versions);
  assert.equal(calls, 0);
  assert.equal(generator.tasks(p.id)[0].state, "interrupted");
  assert.equal(generator.tasks(p.id)[0].recoverable, true);
  assert.throws(() => generator.retry(other.id, "interrupted", () => {}));
  await assert.rejects(
    generator.retry(p.id, "interrupted", () => {}),
    /模拟断网/,
  );
  assert.equal(calls, 1);
  assert.equal(generator.tasks(p.id).length, 2);
  assert.equal(generator.tasks(p.id)[0].state, "failed");
  assert.equal(versions.list(p.id)[0].approved, true);
  db.prepare(
    "INSERT INTO task_runs(id,project_id,state,created_at,release_id) VALUES(?,?,?,?,?)",
  ).run("remote", p.id, "failed", new Date().toISOString(), p.id);
  db.prepare("INSERT INTO step_runs VALUES(?,?,?,?,?)").run(
    "remote-step",
    "remote",
    "failed",
    "remote-publish",
    null,
  );
  assert.throws(() => generator.retry(p.id, "remote", () => {}), /不能重试/);
  generator.close();
  db.close();
});

test("prototype generation consumes manual screenshot bytes and blocks silently ignoring unsupported vision", async () => {
  const root = mkdtempSync(join(tmpdir(), "produck-manual-")),
    db = openProjectDatabase(join(root, "db"));
  const projects = new ProjectRepository(db, join(root, "state")),
    p = projects.create("A", root),
    versions = new PrototypeRepository(db, projects);
  const capture = saveCapture(
    p.workspace,
    {
      title: "画布",
      url: "https://example.com",
      capturedAt: new Date().toISOString(),
      text: "用户补充布局",
      structure: "[]",
      html: "<html><body>代表页面</body></html>",
      actions: [],
      manualScreenshot: true,
    },
    new Uint8Array([1, 2, 3]),
    false,
  );
  let supported = true,
    calls = 0;
  const models = {
    capabilities: () => ({ image: supported ? "supported" : "unsupported" }),
    request: async (_id: string, prompt: string) => ({
      provider: "openai-compatible",
      endpoint: "https://example.com/v1",
      model: "test",
      token: "synthetic",
      prompt,
    }),
  } as unknown as ModelService;
  const generator = new PrototypeGenerator(db, projects, models, versions),
    original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const content = JSON.parse(String(init?.body)).messages[0].content;
    assert.equal(content[0].image_url.url, "data:image/png;base64,AQID");
    assert(content[1].text.includes(capture.id));
    assert(content[1].text.includes("代表页面"));
    return new Response(
      "data: " +
        JSON.stringify({
          choices: [
            {
              delta: {
                content:
                  "<!doctype html><html><body><h1>画布原型</h1></body></html>",
              },
            },
          ],
        }) +
        "\n\ndata: [DONE]\n\n",
    );
  };
  try {
    await generator.generate(p.id, capture.id, () => {});
    assert.equal(calls, 1);
    supported = false;
    await assert.rejects(
      generator.generate(p.id, capture.id, () => {}),
      /图像能力/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    generator.close();
    db.close();
  }
});
