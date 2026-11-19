import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  openProjectDatabase,
  atomicWrite,
} from "../../src/projects/storage.js";
import { ProjectRepository } from "../../src/projects/repository.js";
import { PrototypeRepository } from "../../src/prototypes/repository.js";
import { saveCapture } from "../../src/projects/captures.js";
import { DocumentWorkflow } from "../../src/workflows/documents.js";
import { importSource } from "../../src/projects/sources.js";
import type { ModelService } from "../../src/agent/model-service.js";
const root = process.argv[2],
  db = openProjectDatabase(join(root, "db.sqlite")),
  projects = new ProjectRepository(db, join(root, "state.json"));
const p = projects.create("崩溃恢复项目", root);
projects.select(p.id);
writeFileSync(join(root, "handoff.md"), "# 必须保留的资料");
const source = importSource(p.workspace, join(root, "handoff.md"));
const capture = saveCapture(
  p.workspace,
  {
    title: "列表",
    url: "https://example.test/",
    capturedAt: new Date().toISOString(),
    text: "列表资料",
    structure: "[]",
    actions: [],
  },
  new Uint8Array([1, 2, 3]),
);
const versions = new PrototypeRepository(db, projects),
  baseline = versions.create(p.id, "<html><body>已确认基线</body></html>", [
    capture.id,
  ]);
versions.approve(p.id, baseline.id);
const candidate = versions.create(
  p.id,
  "<html><body>未确认候选</body></html>",
  [capture.id],
  baseline.id,
);
const docs = new DocumentWorkflow(projects, versions, {} as ModelService),
  state = docs.saveState(
    p.id,
    baseline.id,
    "列表",
    "列表内容",
    new Uint8Array([4, 5, 6]),
  );
const draft = {
  id: randomUUID(),
  versionId: baseline.id,
  contentHash: baseline.contentHash,
  stateIds: [state.id],
  createdAt: new Date().toISOString(),
  markdown: "# 已保存 PRD 草稿",
};
atomicWrite(
  join(p.workspace, "documents/drafts.json"),
  JSON.stringify([draft]),
);
atomicWrite(join(p.workspace, `documents/${draft.id}.md`), draft.markdown);
const runId = randomUUID(),
  input = `workflows/${runId}-prototype.json`;
atomicWrite(
  join(p.workspace, input),
  JSON.stringify({
    kind: "prototype",
    captureId: capture.id,
    baselineId: baseline.id,
    change: "新增筛选",
  }),
);
db.prepare("INSERT INTO task_runs VALUES(?,?,?,?)").run(
  runId,
  p.id,
  "running",
  new Date().toISOString(),
);
db.prepare("INSERT INTO step_runs VALUES(?,?,?,?,?)").run(
  randomUUID(),
  runId,
  "running",
  input,
  null,
);
const receipt = {
  id: "uncertain-publication",
  state: "running",
  steps: [
    { key: "create-document", state: "pending", requestId: "stable-request" },
  ],
};
atomicWrite(
  join(p.workspace, "workflows/publications.json"),
  JSON.stringify([receipt]),
);
atomicWrite(
  join(root, "fixture.json"),
  JSON.stringify({
    p,
    source,
    capture,
    baseline,
    candidate,
    state,
    draft,
    runId,
  }),
);
writeFileSync(
  join(
    p.workspace,
    "prototypes/.produck-write-00000000-0000-0000-0000-000000000000.tmp",
  ),
  "incomplete",
);
db.exec("BEGIN IMMEDIATE");
db.prepare("DELETE FROM approvals WHERE artifact_id=?").run(baseline.id);
db.prepare("DELETE FROM artifact_versions WHERE id=?").run(candidate.id);
process.kill(process.pid, "SIGKILL");
