import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDatabase } from "../src/projects/storage.js";
import { PlatformService } from "../src/integrations/platform-service.js";
import { ProjectRepository } from "../src/projects/repository.js";
const feishu = {
  provider: "feishu" as const,
  url: "https://team.feishu.cn/wiki/node1",
  appId: "cli_fixture",
  secret: "synthetic-secret",
};
const yunxiao = {
  provider: "yunxiao" as const,
  url: "https://devops.aliyun.com/projex/project/project1",
  organizationId: "org1",
  projectId: "project1",
  secret: "synthetic-pat",
  statusMapping: { published: "design" },
};
function fixture(transport: typeof fetch) {
  const path = join(mkdtempSync(join(tmpdir(), "produck-platform-")), "db"),
    db = openProjectDatabase(path);
  for (const id of ["a", "b"])
    db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run(
      id,
      id,
      "/" + id,
      "now",
    );
  db.exec(
    "INSERT INTO releases SELECT id,id,'默认版本','','',created_at FROM projects",
  );
  const secrets = new Map<string, string>();
  const service = new PlatformService(
    db,
    {
      set: async (id, v) => {
        secrets.set(id, v);
      },
      get: async (id) => secrets.get(id) ?? null,
      delete: async (id) => {
        secrets.delete(id);
      },
    },
    transport,
  );
  return { path, db, secrets, service };
}
const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
test("platform credentials stay scoped and out of SQLite, rotation preserves mapping and legacy address cannot erase config", async () => {
  const f = fixture(async () => {
    throw new Error("must not call API on save");
  });
  await f.service.save("a", yunxiao);
  assert.equal(f.service.profile("b", "yunxiao"), null);
  await assert.rejects(f.service.test("b", "yunxiao"), /先保存/);
  await f.service.save("a", {
    ...yunxiao,
    secret: "new-pat",
    statusMapping: { merged: "done" },
  });
  assert.equal(f.secrets.size, 1);
  assert.deepEqual(f.service.profile("a", "yunxiao")?.statusMapping, {
    merged: "done",
  });
  const repo = new ProjectRepository(f.db, "/unused");
  assert.throws(
    () => repo.saveConnection("a", { provider: "yunxiao", url: yunxiao.url }),
    /平台连接设置/,
  );
  await f.service.save("a", feishu);
  await assert.rejects(
    f.service.save("a", { ...feishu, appId: "cli_other", secret: undefined }),
    /重新填写/,
  );
  assert(
    !JSON.stringify(f.service.profile("a", "feishu")).includes(feishu.secret),
  );
  f.db.close();
  const raw = readFileSync(f.path).toString();
  for (const secret of [feishu.secret, yunxiao.secret, "new-pat"])
    assert(!raw.includes(secret));
});
test("Feishu read-only probe verifies the exact wiki node with a fresh tenant token", async () => {
  const calls: string[] = [];
  const f = fixture(async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.redirect, "error");
    if (String(url).includes("tenant_access_token")) {
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        app_id: feishu.appId,
        app_secret: feishu.secret,
      });
      return json({ code: 0, tenant_access_token: "temporary-fixture" });
    }
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer temporary-fixture",
    );
    assert.equal(init?.method, undefined);
    return json({
      code: 0,
      data: {
        node: {
          node_token: "node1",
          space_id: "space1",
          obj_type: "docx",
          title: "迭代文档",
        },
      },
    });
  });
  await f.service.save("a", feishu);
  assert.equal((await f.service.test("a", "feishu")).title, "迭代文档");
  assert.deepEqual(calls, [
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    "https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=node1",
  ]);
  f.db.close();
});
test("Yunxiao probe uses central PAT API and validates returned project identity", async () => {
  let mismatch = false;
  const f = fixture(async (url, init) => {
    assert.equal(
      String(url),
      "https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org1/projects/project1",
    );
    assert.equal(
      new Headers(init?.headers).get("x-yunxiao-token"),
      yunxiao.secret,
    );
    assert.equal(init?.method, undefined);
    return json({ id: mismatch ? "other" : "project1", name: "项目" });
  });
  await f.service.save("a", yunxiao);
  assert.equal((await f.service.test("a", "yunxiao")).scope, "read-only");
  mismatch = true;
  await assert.rejects(f.service.test("a", "yunxiao"), /不匹配/);
  f.db.close();
});
test("bad endpoints, error payloads and concurrent config changes never report success or leak secrets", async () => {
  const f = fixture(
    async () => new Response("synthetic-secret", { status: 403 }),
  );
  await assert.rejects(
    f.service.save("a", {
      ...feishu,
      url: "https://attacker.example/wiki/node1",
    }),
    /飞书/,
  );
  await assert.rejects(
    f.service.save("a", { ...yunxiao, organizationId: "../escape" }),
    /格式/,
  );
  await assert.rejects(
    f.service.save("a", { ...yunxiao, url: yunxiao.url + "?token=secret" }),
    /参数/,
  );
  await f.service.save("a", feishu);
  await assert.rejects(
    f.service.test("a", "feishu"),
    (e) =>
      e instanceof Error &&
      /权限/.test(e.message) &&
      !e.message.includes(feishu.secret),
  );
  f.db.close();
  const g = fixture(async () => {
    await g.service.save("a", {
      ...yunxiao,
      statusMapping: { merged: "changed" },
    });
    return json({ id: "project1", name: "old" });
  });
  await g.service.save("a", yunxiao);
  await assert.rejects(g.service.test("a", "yunxiao"), /配置发生变化/);
  g.db.close();
});
