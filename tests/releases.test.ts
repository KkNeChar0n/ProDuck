import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openProjectDatabase,
  migrations,
  atomicWrite,
} from "../src/projects/storage.js";
import { ProjectRepository } from "../src/projects/repository.js";
import { PrototypeRepository, hash } from "../src/prototypes/repository.js";
import { ModelService } from "../src/agent/model-service.js";
import { PlatformService } from "../src/integrations/platform-service.js";
import { DocumentWorkflow } from "../src/workflows/documents.js";
import { AgentRunner } from "../src/agent/runner.js";
import { ToolRegistry } from "../src/agent/tools.js";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "produck-releases-"));
  const db = openProjectDatabase(join(root, "db"));
  const projects = new ProjectRepository(db, join(root, "state"));
  const project = projects.create("产品", root);
  const a = projects.createRelease(project.id, "V1"),
    b = projects.createRelease(project.id, "V2");
  const versions = new PrototypeRepository(db, projects);
  const secrets = new Map<string, string>();
  const credentials = {
    set: async (id: string, v: string) => {
      secrets.set(id, v);
    },
    get: async (id: string) => secrets.get(id) ?? null,
    delete: async (id: string) => {
      secrets.delete(id);
    },
  };
  return { root, db, projects, project, a, b, versions, credentials };
}
test("new projects require a release; artifacts, approval, screenshots and task completion remain in their original release", async () => {
  const f = fixture();
  const other = f.projects.create("另一项目", f.root);
  assert.throws(() => f.projects.context(other.id), /创建并选择/);
  assert.throws(() => f.projects.selectRelease(other.id, f.a.id), /不属于/);
  assert.throws(() => f.projects.createRelease(f.project.id, "V1"), /已存在/);
  const v = f.versions.create(f.a.id, "<html>V1</html>", []);
  f.versions.approve(f.a.id, v.id);
  assert.equal(f.versions.list(f.b.id).length, 0);
  assert.throws(() => f.versions.read(f.b.id, v.id), /不属于/);
  const copy = f.versions.create(f.b.id, f.versions.read(f.a.id, v.id), []);
  assert.equal(copy.approved, false);
  assert.equal(f.versions.list(f.a.id)[0].approved, true);
  const docs = new DocumentWorkflow(f.projects, f.versions, {} as ModelService);
  docs.saveState(f.a.id, v.id, "列表", "文字", new Uint8Array([1]));
  assert.equal(docs.states(f.b.id).length, 0);
  let complete!: (value: string) => void;
  const tools = new ToolRegistry(f.projects, f.versions, {} as any);
  const runner = new AgentRunner(
    f.db,
    f.projects,
    tools,
    async () =>
      new Promise<string>((resolve) => {
        complete = resolve;
      }),
    () => {},
  );
  const run = runner.start(f.a.id, "测试版本绑定", 2);
  f.projects.selectRelease(f.project.id, f.b.id);
  for (let i = 0; !complete && i < 100; i++)
    await new Promise((r) => setTimeout(r, 5));
  complete(JSON.stringify({ done: "完成" }));
  for (let i = 0; runner.list(f.a.id)[0].state !== "succeeded" && i < 100; i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.equal(runner.list(f.a.id)[0].id, run.id);
  assert.equal(runner.list(f.a.id)[0].state, "succeeded");
  assert.deepEqual(runner.list(f.b.id), []);
  assert.equal(f.projects.state().activeReleaseId, f.b.id);
  runner.close();
  docs.close();
  f.db.close();
});
test("model and platform credentials are shared while Feishu destinations are per release and never inherited", async () => {
  const f = fixture(),
    models = new ModelService(f.db, f.credentials),
    platforms = new PlatformService(f.db, f.credentials);
  await models.save(f.project.id, {
    provider: "openai-compatible",
    endpoint: "https://example.com/v1",
    model: "test",
    token: "fixture",
  });
  assert.deepEqual(models.profile(f.a.id), models.profile(f.b.id));
  assert.equal((await models.request(f.b.id, "hello")).token, "fixture");
  await platforms.save(f.project.id, {
    provider: "feishu",
    url: "",
    appId: "cli_fixture",
    secret: "fixture",
  });
  f.projects.updateRelease(
    f.a.id,
    "V1",
    "https://example.feishu.cn/wiki/first",
  );
  assert.equal(
    platforms.profile(f.a.id, "feishu")!.url,
    "https://example.feishu.cn/wiki/first",
  );
  assert.equal(platforms.profile(f.b.id, "feishu")!.url, "");
  f.projects.updateRelease(
    f.b.id,
    "V2",
    "https://example.feishu.cn/wiki/second",
  );
  await platforms.save(f.project.id, {
    provider: "feishu",
    url: "",
    appId: "cli_fixture",
    secret: "rotated",
  });
  assert.equal(
    platforms.profile(f.a.id, "feishu")!.url,
    "https://example.feishu.cn/wiki/first",
  );
  assert.equal(
    platforms.profile(f.b.id, "feishu")!.url,
    "https://example.feishu.cn/wiki/second",
  );
  await platforms.save(f.project.id, {
    provider: "yunxiao",
    url: "https://devops.aliyun.com/test",
    organizationId: "org",
    projectId: "proj",
    secret: "pat",
    statusMapping: { published: "design" },
  });
  assert.deepEqual(
    platforms.profile(f.a.id, "yunxiao"),
    platforms.profile(f.b.id, "yunxiao"),
  );
  assert.equal(f.projects.shared(f.a.id).workspace, f.project.workspace);
  assert.notEqual(
    f.projects.context(f.a.id).workspace,
    f.projects.context(f.b.id).workspace,
  );
  assert.throws(() =>
    f.projects.updateRelease(f.b.id, "V2", "https://evil.example/wiki/x"),
  );
  f.db.close();
});
test("v2 migration preserves exact old files, approvals and receipts and assigns the existing target only to the default release", () => {
  const root = mkdtempSync(join(tmpdir(), "produck-release-migrate-")),
    path = join(root, "db");
  let db = openProjectDatabase(path, migrations.slice(0, 2));
  const projects = new ProjectRepository(db, join(root, "state"));
  const p = projects.create("旧项目", root),
    html = "<html>旧基线</html>";
  atomicWrite(join(p.workspace, "prototypes/old.html"), html);
  atomicWrite(
    join(p.workspace, "workflows/publications.json"),
    '[{"state":"published","remote":"keep"}]',
  );
  db.prepare("INSERT INTO artifact_versions VALUES(?,?,?,?,?,?,?)").run(
    "artifact",
    p.id,
    null,
    "prototypes/old.html",
    hash(html),
    "[]",
    "now",
  );
  db.prepare("INSERT INTO approvals VALUES(?,?,?,?)").run(
    "approval",
    "artifact",
    hash(html),
    "now",
  );
  db.prepare("INSERT INTO connections VALUES(?,?,?,?,?)").run(
    "connection",
    p.id,
    "feishu",
    JSON.stringify({
      provider: "feishu",
      appId: "cli_old",
      url: "https://example.feishu.cn/wiki/old",
    }),
    "ref",
  );
  db.close();
  db = openProjectDatabase(path);
  const migrated = new ProjectRepository(db, join(root, "state")),
    versions = new PrototypeRepository(db, migrated);
  assert.equal(migrated.releases(p.id)[0].id, p.id);
  assert.equal(migrated.context(p.id).workspace, p.workspace);
  assert.equal(
    migrated.release(p.id).feishuUrl,
    "https://example.feishu.cn/wiki/old",
  );
  assert.equal(versions.read(p.id, "artifact"), html);
  assert.equal(versions.list(p.id)[0].approved, true);
  assert.equal(
    readFileSync(join(p.workspace, "workflows/publications.json"), "utf8"),
    '[{"state":"published","remote":"keep"}]',
  );
  const next = migrated.createRelease(p.id, "V2");
  assert.deepEqual(versions.list(next.id), []);
  assert.equal(next.feishuUrl, "");
  db.close();
});
