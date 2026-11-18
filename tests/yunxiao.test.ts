import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDatabase } from "../src/projects/storage.js";
import { ProjectRepository } from "../src/projects/repository.js";
import { YunxiaoSyncWorkflow } from "../src/workflows/yunxiao-sync.js";
import { YunxiaoClient } from "../src/integrations/yunxiao.js";
import type { PublicationRun } from "../src/contracts/publication.js";
import type { PlatformProfile } from "../src/contracts/platforms.js";
function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), "produck-yunxiao-")),
    db = openProjectDatabase(join(root, "db")),
    projects = new ProjectRepository(db, join(root, "state")),
    p = projects.create("A", root);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const config = {
    provider: "yunxiao",
    hasCredential: true,
    organizationId: "org",
    projectId: "proj",
    statusMapping: { published: "design" },
  } as PlatformProfile;
  const run = {
    id: "publication",
    digest: "hash",
    state: "published",
    documentUrl: "https://example.feishu.cn/wiki/doc",
    steps: [{ state: "done" }],
  } as PublicationRun;
  const item = {
    id: "item",
    title: "需求",
    projectId: "proj",
    typeId: "requirement",
    status: { id: "todo", name: "待开始" },
    updatedAt: "1",
  };
  let writes = 0,
    reads = 0,
    lost = false,
    mismatch = false;
  const client = {
    item: async () => {
      reads++;
      return structuredClone(item);
    },
    statuses: async () => [{ id: "design", name: "设计中" }],
    setStatus: async () => {
      writes++;
      if (!mismatch) item.status = { id: "design", name: "设计中" };
      if (lost) throw new Error("写入结果未确认");
    },
  };
  const service = () =>
    new YunxiaoSyncWorkflow(
      projects,
      { list: () => [run] },
      { profile: () => config },
      async () => client,
    );
  return {
    p,
    config,
    run,
    item,
    client,
    service,
    writes: () => writes,
    reads: () => reads,
    lose: () => {
      lost = true;
    },
    mismatch: () => {
      mismatch = true;
    },
  };
}
test("sync persists exact mapped status and readback, repeated execution only reads", async (t) => {
  const f = fixture(t),
    s = f.service(),
    plan = await s.prepare(f.p.id, "publication", "item");
  const result = await s.execute(f.p.id, plan.id, plan.digest);
  assert.equal(result.state, "synced");
  assert.equal(f.writes(), 1);
  assert.equal(
    (await f.service().execute(f.p.id, plan.id, plan.digest)).state,
    "synced",
  );
  assert.equal(f.writes(), 1);
  assert.equal((await s.prepare(f.p.id, "publication", "item")).id, plan.id);
  assert.match(
    readFileSync(join(f.p.workspace, "workflows/yunxiao-sync.json"), "utf8"),
    /完成状态读回/,
  );
});
test("missing mapping and incomplete publication prevent network calls", async (t) => {
  const f = fixture(t);
  f.config.statusMapping = {};
  await assert.rejects(f.service().prepare(f.p.id, "publication", "item"));
  assert.equal(f.reads(), 0);
  f.config.statusMapping = { published: "design" };
  f.run.state = "partial";
  await assert.rejects(f.service().prepare(f.p.id, "publication", "item"));
  assert.equal(f.reads(), 0);
});
test("cross-project item and unavailable target rejected", async (t) => {
  const f = fixture(t);
  f.item.projectId = "other";
  await assert.rejects(f.service().prepare(f.p.id, "publication", "item"));
  f.item.projectId = "proj";
  f.config.statusMapping = { published: "missing" };
  await assert.rejects(f.service().prepare(f.p.id, "publication", "item"));
  assert.equal(f.writes(), 0);
});
test("changed state or config invalidates prepared confirmation", async (t) => {
  const f = fixture(t),
    s = f.service(),
    p = await s.prepare(f.p.id, "publication", "item");
  f.item.updatedAt = "2";
  assert.equal((await s.execute(f.p.id, p.id, p.digest)).state, "conflict");
  assert.equal(f.writes(), 0);
  const p2 = await s.prepare(f.p.id, "publication", "item");
  f.config.statusMapping = { published: "other" };
  await assert.rejects(s.execute(f.p.id, p2.id, p2.digest));
  assert.equal(f.writes(), 0);
});
test("lost write response recovers across restart without another PUT", async (t) => {
  const f = fixture(t),
    s = f.service(),
    p = await s.prepare(f.p.id, "publication", "item");
  f.lose();
  assert.equal((await s.execute(f.p.id, p.id, p.digest)).state, "needs-check");
  assert.equal(f.run.state, "published");
  assert.equal(
    (await f.service().execute(f.p.id, p.id, p.digest)).state,
    "synced",
  );
  assert.equal(f.writes(), 1);
});
test("mismatched readback stays uncertain, parallel plan cannot resend", async (t) => {
  const f = fixture(t),
    s = f.service(),
    p = await s.prepare(f.p.id, "publication", "item"),
    p2 = await s.prepare(f.p.id, "publication", "item");
  f.mismatch();
  assert.equal((await s.execute(f.p.id, p.id, p.digest)).state, "needs-check");
  await assert.rejects(s.execute(f.p.id, p2.id, p2.digest));
  assert.equal((await s.execute(f.p.id, p.id, p.digest)).state, "needs-check");
  assert.equal(f.writes(), 1);
});
test("already mapped status requires no write", async (t) => {
  const f = fixture(t);
  f.item.status = { id: "design", name: "设计中" };
  const s = f.service(),
    p = await s.prepare(f.p.id, "publication", "item");
  assert.equal((await s.execute(f.p.id, p.id, p.digest)).state, "synced");
  assert.equal(f.writes(), 0);
});
test("adapter uses exact central-edition API and accepts empty update response", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = new YunxiaoClient("org", "proj", "synthetic-token", (async (
    url,
    init,
  ) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  }) as typeof fetch);
  await client.setStatus("item", "design");
  assert.equal(
    calls[0].url,
    "https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org/workitems/item",
  );
  assert.equal(calls[0].init?.method, "PUT");
  assert.equal(calls[0].init?.body, '{"status":"design"}');
  assert.equal(calls[0].init?.redirect, "error");
  const denied = new YunxiaoClient(
    "org",
    "proj",
    "synthetic-token",
    (async () =>
      new Response("synthetic-token", { status: 403 })) as typeof fetch,
  );
  await assert.rejects(
    denied.item("item"),
    (e) => e instanceof Error && !e.message.includes("synthetic-token"),
  );
});
test("adapter rejects archived and foreign work items", async () => {
  for (const value of [
    {
      id: "item",
      space: { id: "other" },
      logicalStatus: "normal",
      subject: "a",
    },
    {
      id: "item",
      space: { id: "proj" },
      logicalStatus: "archived",
      subject: "a",
    },
  ]) {
    const c = new YunxiaoClient("org", "proj", "test", (async () =>
      Response.json(value)) as typeof fetch);
    await assert.rejects(c.item("item"));
  }
});
