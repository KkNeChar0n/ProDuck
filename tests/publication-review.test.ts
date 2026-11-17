import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDatabase } from "../src/projects/storage.js";
import { ProjectRepository } from "../src/projects/repository.js";
import { PrototypeRepository } from "../src/prototypes/repository.js";
import { DocumentWorkflow } from "../src/workflows/documents.js";
import { PublicationReviews } from "../src/workflows/publication-review.js";
import type { ModelService } from "../src/agent/model-service.js";
function setup() {
  const root = mkdtempSync(join(tmpdir(), "produck-review-")),
    db = openProjectDatabase(join(root, "db")),
    projects = new ProjectRepository(db, join(root, "state")),
    p = projects.create("A", root),
    b = projects.create("B", root),
    versions = new PrototypeRepository(db, projects),
    documents = new DocumentWorkflow(projects, versions, {} as ModelService);
  const v = versions.create(p.id, "<html><body>批准原型</body></html>", []);
  versions.approve(p.id, v.id);
  const state = documents.saveState(
    p.id,
    v.id,
    "列表",
    "",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const draft = {
    id: "draft1",
    versionId: v.id,
    contentHash: v.contentHash,
    stateIds: [state.id],
    createdAt: "now",
    markdown: "# 需求\n筛选客户",
  };
  writeFileSync(
    join(p.workspace, "documents/drafts.json"),
    JSON.stringify([draft]),
  );
  let title = "迭代",
    url = "https://example.feishu.cn/wiki/parent",
    reads = 0;
  const platforms = {
    profile: () => ({
      provider: "feishu" as const,
      appId: "cli_fixture",
      url,
      hasCredential: true,
    }),
    test: async () => {
      reads++;
      return {
        targetId: "parent",
        title,
        checkedAt: "now",
        scope: "read-only" as const,
      };
    },
  };
  const reviews = new PublicationReviews(
    projects,
    versions,
    documents,
    platforms,
  );
  return {
    db,
    p,
    b,
    v,
    state,
    draft,
    versions,
    reviews,
    reads: () => reads,
    rename: () => {
      title = "新迭代";
    },
    move: () => {
      url = "https://example.feishu.cn/wiki/other";
    },
  };
}
test("publication review snapshots exact approved assets, binds target and survives restart without any remote write", async () => {
  const f = setup();
  const review = await f.reviews.prepare(f.p.id, f.draft.id);
  assert.equal(review.status, "prepared");
  assert.equal(review.files.length, 3);
  assert.equal(
    readFileSync(join(f.p.workspace, review.files[0].path), "utf8"),
    f.draft.markdown,
  );
  assert.equal(f.reviews.list(f.b.id).length, 0);
  await assert.rejects(
    f.reviews.approve(f.b.id, review.id, review.digest),
    /不存在/,
  );
  await assert.rejects(f.reviews.approve(f.p.id, review.id, "wrong"), /变化/);
  const approved = await f.reviews.approve(f.p.id, review.id, review.digest);
  assert.equal(approved.status, "approved");
  assert(approved.approvedAt);
  assert.equal(f.reads(), 2);
  assert.equal(f.reviews.list(f.p.id)[0].digest, review.digest);
  f.db.close();
});
test("changed parent, edited source, tampered snapshot and revoked prototype invalidate review", async () => {
  for (const change of [
    "parent",
    "connection",
    "source",
    "snapshot",
    "approval",
  ] as const) {
    const f = setup(),
      review = await f.reviews.prepare(f.p.id, f.draft.id);
    if (change === "parent") f.rename();
    if (change === "connection") f.move();
    if (change === "source")
      writeFileSync(
        join(f.p.workspace, "documents/drafts.json"),
        JSON.stringify([{ ...f.draft, markdown: "changed" }]),
      );
    if (change === "snapshot")
      writeFileSync(join(f.p.workspace, review.files[0].path), "tampered");
    if (change === "approval")
      f.versions.recordCheck(f.p.id, f.v.id, "filter", "failed", "筛选失效");
    await assert.rejects(f.reviews.approve(f.p.id, review.id, review.digest));
    assert.equal(f.reviews.list(f.p.id)[0].status, "prepared");
    f.db.close();
  }
});
