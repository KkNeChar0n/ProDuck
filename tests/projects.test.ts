import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDatabase } from "../src/projects/storage.js";
import { ProjectRepository } from "../src/projects/repository.js";
test("projects persist selection, independent workspaces and project-scoped connections", () => {
  const root = mkdtempSync(join(tmpdir(), "produck-projects-")),
    file = join(root, "db.sqlite"),
    state = join(root, "state.json");
  let db = openProjectDatabase(file),
    repo = new ProjectRepository(db, state);
  const a = repo.create("项目 A", root),
    b = repo.create("项目 B", root);
  assert.notEqual(a.workspace, b.workspace);
  assert(existsSync(join(a.workspace, "prototypes")));
  repo.saveConnection(a.id, {
    provider: "feishu",
    url: "https://example.feishu.cn/wiki/demo",
  });
  assert.equal(repo.connections(b.id).length, 0);
  assert.equal(repo.connections(a.id).length, 1);
  assert.throws(() =>
    repo.saveConnection(a.id, {
      provider: "feishu",
      url: "https://user:token@example.com",
    }),
  );
  assert.throws(() =>
    repo.saveConnection(a.id, {
      provider: "feishu",
      url: "https://example.com/?token=secret",
    }),
  );
  assert.throws(() => repo.get("not-found"));
  repo.select(b.id);
  db.close();
  db = openProjectDatabase(file);
  repo = new ProjectRepository(db, state);
  assert.equal(repo.state().activeProjectId, b.id);
  assert.equal(repo.state().projects.length, 2);
  assert.match(repo.readMemory(a.id), /项目 A/);
  assert.doesNotMatch(readFileSync(state, "utf8"), /token|secret/);
  db.close();
});
