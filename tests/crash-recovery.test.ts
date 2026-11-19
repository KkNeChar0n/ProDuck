import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  openProjectDatabase,
  migrations,
  discardInterruptedWrites,
} from "../src/projects/storage.js";
import { ProjectRepository } from "../src/projects/repository.js";
import { PrototypeRepository } from "../src/prototypes/repository.js";
import { PrototypeGenerator } from "../src/agent/prototype-generator.js";
import { DocumentWorkflow } from "../src/workflows/documents.js";
import { PublicationWorkflow } from "../src/workflows/publication.js";
import { listSources } from "../src/projects/sources.js";
import type { ModelService } from "../src/agent/model-service.js";
import type { PublicationReviews } from "../src/workflows/publication-review.js";
function hashes(root: string) {
  const result: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(join(root, dir)).sort()) {
      const path = join(dir, name);
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else
        result[path] = createHash("sha256")
          .update(readFileSync(join(root, path)))
          .digest("hex");
    }
  };
  walk("");
  return result;
}
test("SIGKILL rollback, offline retry and failed migration retain project artifacts across processes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "produck-crash-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", resolve("tests/fixtures/crash-workspace.ts"), root],
    { cwd: process.cwd(), encoding: "utf8", timeout: 20000 },
  );
  assert.equal(child.signal, "SIGKILL", child.stderr);
  const f = JSON.parse(readFileSync(join(root, "fixture.json"), "utf8")),
    file = join(root, "db.sqlite");
  let db = openProjectDatabase(file),
    projects = new ProjectRepository(db, join(root, "state.json")),
    versions = new PrototypeRepository(db, projects);
  assert.equal(projects.state().activeProjectId, f.p.id);
  assert.equal(versions.list(f.p.id).length, 2);
  assert.equal(
    versions.list(f.p.id).find((v) => v.id === f.baseline.id)?.approved,
    true,
  );
  assert.equal(listSources(f.p.workspace)[0].id, f.source.id);
  assert.equal(discardInterruptedWrites(f.p.workspace), 1);
  const stable = hashes(f.p.workspace);
  let calls = 0;
  const models = {
    request: async () => {
      calls++;
      throw new Error("模拟断网");
    },
  } as unknown as ModelService;
  const docs = new DocumentWorkflow(projects, versions, models);
  assert.deepEqual(docs.list(f.p.id), [f.draft]);
  assert.deepEqual(docs.states(f.p.id), [f.state]);
  const generator = new PrototypeGenerator(db, projects, models, versions);
  assert.equal(generator.tasks(f.p.id)[0].state, "interrupted");
  assert.equal(calls, 0);
  const publication = new PublicationWorkflow(
    projects,
    {} as PublicationReviews,
    async () => {
      throw new Error("不应联网");
    },
  );
  assert.equal(publication.list(f.p.id)[0].state, "needs-check");
  assert.deepEqual(hashes(f.p.workspace), stable);
  await assert.rejects(
    generator.retry(f.p.id, f.runId, () => {}),
    /模拟断网/,
  );
  assert.equal(calls, 1);
  for (const [path, hash] of Object.entries(stable))
    assert.equal(hashes(f.p.workspace)[path], hash, path);
  const restored = versions.restore(f.p.id, f.baseline.id);
  assert.equal(restored.contentHash, f.baseline.contentHash);
  assert.equal(restored.approved, false);
  assert.equal(restored.baselineId, f.baseline.id);
  const beforeMigration = hashes(f.p.workspace);
  generator.close();
  docs.close();
  db.close();
  assert.throws(() =>
    openProjectDatabase(file, [
      ...migrations,
      {
        version: migrations.at(-1)!.version + 1,
        sql: "DELETE FROM approvals; ALTER TABLE projects ADD COLUMN extra TEXT; INVALID SQL;",
      },
    ]),
  );
  db = openProjectDatabase(file);
  projects = new ProjectRepository(db, join(root, "state.json"));
  versions = new PrototypeRepository(db, projects);
  assert.equal(versions.list(f.p.id).length, 3);
  assert.equal(
    versions.list(f.p.id).find((v) => v.id === f.baseline.id)?.approved,
    true,
  );
  assert.equal(projects.state().activeProjectId, f.p.id);
  assert.deepEqual(hashes(f.p.workspace), beforeMigration);
  assert.match(versions.read(f.p.id, f.baseline.id), /已确认基线/);
  db.close();
});
