import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  signYunxiaoAk,
  YunxiaoAkClient,
} from "../src/integrations/yunxiao-ak.js";
import { openProjectDatabase } from "../src/projects/storage.js";
import { PlatformService } from "../src/integrations/platform-service.js";
test("ACS3 POST signature agrees with official Python SDK fixture", () => {
  const body =
    '{"identifier":"item","fieldType":"status","propertyKey":"status","propertyValue":"design"}';
  const h = signYunxiaoAk(
    "POST",
    "/organization/org/workitems/update",
    "UpdateWorkItem",
    body,
    "fixture-id",
    "fixture-secret",
    "2026-11-23T00:00:00Z",
    "fixture-nonce",
  );
  assert.equal(
    h.Authorization,
    "ACS3-HMAC-SHA256 Credential=fixture-id,SignedHeaders=content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=56f477696ec9d8310a0bf9255968b9ec157539f1f660ff6a5ed606e42c6656ee",
  );
  assert.notEqual(
    signYunxiaoAk(
      "POST",
      "/organization/org/workitems/update",
      "UpdateWorkItem",
      body + " ",
      "fixture-id",
      "fixture-secret",
      "2026-11-23T00:00:00Z",
      "fixture-nonce",
    ).Authorization,
    h.Authorization,
  );
});
test("AK maps official project/item/workflow contracts and only writes the requested status", async () => {
  const calls: any[] = [];
  let foreign = false,
    rejected = false;
  const client = new YunxiaoAkClient(
    "org",
    "proj",
    "fixture-id",
    "fixture-secret",
    async (url, init) => {
      calls.push({ url: String(url), init });
      const action = (init!.headers as Record<string, string>)["x-acs-action"];
      assert.equal(init!.redirect, "error");
      assert(
        String(url).startsWith(
          "https://devops.cn-hangzhou.aliyuncs.com/organization/org/",
        ),
      );
      assert(!String(url).includes("fixture-id"));
      assert(!String(init!.body ?? "").includes("fixture-secret"));
      if (action === "GetProjectInfo")
        return Response.json({
          success: true,
          project: {
            identifier: "proj",
            organizationIdentifier: "org",
            logicalStatus: "NORMAL",
            name: "产品",
          },
        });
      if (action === "GetWorkItemInfo")
        return Response.json({
          success: true,
          workitem: {
            identifier: "item",
            spaceIdentifier: foreign ? "other" : "proj",
            logicalStatus: "NORMAL",
            subject: "需求",
            workitemTypeIdentifier: "type",
            statusIdentifier: "todo",
            status: "待处理",
          },
        });
      if (action === "GetWorkItemWorkFlowInfo") {
        assert(String(url).endsWith("/workitems/item/getWorkflowInfo"));
        return Response.json({
          success: true,
          workflow: { statuses: [{ identifier: "design", name: "设计中" }] },
        });
      }
      assert.equal(init!.method, "POST");
      assert.deepEqual(JSON.parse(String(init!.body)), {
        identifier: "item",
        fieldType: "status",
        propertyKey: "status",
        propertyValue: "design",
      });
      return Response.json({ success: !rejected });
    },
  );
  assert.equal((await client.project()).name, "产品");
  const item = await client.item("item");
  assert.equal(item.status.id, "todo");
  assert.equal((await client.statuses(item.typeId, item.id))[0].id, "design");
  await client.setStatus("item", "design");
  foreign = true;
  await assert.rejects(client.item("item"), /不属于/);
  rejected = true;
  await assert.rejects(client.setStatus("item", "design"), /未确认/);
  let attempts = 0;
  const failing = new YunxiaoAkClient(
    "org",
    "proj",
    "fixture-id",
    "fixture-secret",
    async () => {
      attempts++;
      throw new Error("fixture-secret");
    },
  );
  await assert.rejects(failing.setStatus("item", "design"), /写入结果未确认/);
  assert.equal(attempts, 1);
  const forbidden = new YunxiaoAkClient(
    "org",
    "proj",
    "fixture-id",
    "fixture-secret",
    async () => new Response("fixture-secret", { status: 403 }),
  );
  await assert.rejects(forbidden.item("item"), /AK 鉴权/);
});
test("AK pair remains in keychain; auth changes and partial rotations cannot reuse the wrong credential", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "produck-ak-")), "db"),
    db = openProjectDatabase(path);
  db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run("p", "P", "/p", "now");
  const keys = new Map<string, string>();
  const service = new PlatformService(
    db,
    {
      set: async (k, v) => {
        keys.set(k, v);
      },
      get: async (k) => keys.get(k) ?? null,
      delete: async (k) => {
        keys.delete(k);
      },
    },
    async () =>
      Response.json({
        success: true,
        project: {
          identifier: "proj",
          organizationIdentifier: "org",
          logicalStatus: "NORMAL",
          name: "产品",
        },
      }),
  );
  const config = {
    provider: "yunxiao" as const,
    url: "https://devops.aliyun.com/proj",
    organizationId: "org",
    projectId: "proj",
  };
  await service.save("p", { ...config, secret: "old-pat" });
  await assert.rejects(
    service.save("p", { ...config, authType: "ak" }),
    /重新填写/,
  );
  await assert.rejects(
    service.save("p", {
      ...config,
      authType: "ak",
      accessKeyId: "fixture-ak-id",
    }),
    /同时填写|重新填写/,
  );
  await service.save("p", {
    ...config,
    authType: "ak",
    accessKeyId: "fixture-ak-id",
    secret: "fixture-ak-secret",
  });
  assert.equal(keys.size, 1);
  assert.equal(service.profile("p", "yunxiao")!.authType, "ak");
  assert.equal((await service.test("p", "yunxiao")).title, "产品");
  await service.save("p", { ...config, authType: "ak" });
  await assert.rejects(
    service.save("p", { ...config, authType: "ak", secret: "partial" }),
    /同时填写|重新填写/,
  );
  await assert.rejects(
    service.save("p", { ...config, authType: "pat" }),
    /重新填写/,
  );
  assert(
    !JSON.stringify(service.profile("p", "yunxiao")).includes("fixture-ak-id"),
  );
  db.close();
  const raw = readFileSync(path).toString();
  for (const value of ["fixture-ak-id", "fixture-ak-secret", "old-pat"])
    assert(!raw.includes(value));
});
