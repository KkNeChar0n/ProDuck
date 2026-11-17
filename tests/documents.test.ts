import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDatabase } from "../src/projects/storage.js";
import { ProjectRepository } from "../src/projects/repository.js";
import { PrototypeRepository } from "../src/prototypes/repository.js";
import { DocumentWorkflow } from "../src/workflows/documents.js";
import type { ModelService } from "../src/agent/model-service.js";
test("PRD requires exact approved version and matching screenshots before any model call", async () => {
  const root = mkdtempSync(join(tmpdir(), "produck-documents-")),
    db = openProjectDatabase(join(root, "db")),
    projects = new ProjectRepository(db, join(root, "state")),
    p = projects.create("A", root),
    b = projects.create("B", root),
    versions = new PrototypeRepository(db, projects);
  let called = 0;
  const models = {
    request: async () => {
      called++;
      throw new Error("模拟断网");
    },
  } as unknown as ModelService;
  const docs = new DocumentWorkflow(projects, versions, models),
    v = versions.create(p.id, "<html><body>批准内容</body></html>", []);
  assert.throws(
    () => docs.saveState(p.id, v.id, "列表", "内容", new Uint8Array([1])),
    /先通过/,
  );
  await assert.rejects(docs.generate(p.id, v.id, ["x"], ""), /先通过/);
  assert.equal(called, 0);
  versions.approve(p.id, v.id);
  const state = docs.saveState(p.id, v.id, "列表", "内容", new Uint8Array([1]));
  const candidate = versions.create(
    p.id,
    "<html><body>候选内容</body></html>",
    [],
    v.id,
  );
  await assert.rejects(
    docs.generate(p.id, candidate.id, [state.id], ""),
    /先通过/,
  );
  versions.approve(p.id, candidate.id);
  await assert.rejects(
    docs.generate(p.id, candidate.id, [state.id], ""),
    /不匹配/,
  );
  await assert.rejects(docs.generate(b.id, v.id, [state.id], ""));
  assert.equal(called, 0);
  await assert.rejects(docs.generate(p.id, v.id, [state.id], ""), /模拟断网/);
  assert.equal(called, 1);
  assert.equal(docs.list(p.id).length, 0);
  docs.close();
  db.close();
});
