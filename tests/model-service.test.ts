import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDatabase } from "../src/projects/storage.js";
import { ModelService } from "../src/agent/model-service.js";
test("model credentials stay out of project database and cannot cross project boundaries", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "produck-model-")), "db.sqlite"),
    db = openProjectDatabase(path);
  for (const id of ["a", "b"])
    db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run(
      id,
      id,
      "/" + id,
      "now",
    );
  const secrets = new Map<string, string>();
  const service = new ModelService(db, {
    set: async (id, v) => {
      secrets.set(id, v);
    },
    get: async (id) => secrets.get(id) ?? null,
    delete: async (id) => {
      secrets.delete(id);
    },
  });
  const profile = await service.save("a", {
    provider: "openai-compatible",
    endpoint: "https://example.com/v1",
    model: "fixture",
    token: "private-test-value",
  });
  assert.equal(profile.hasCredential, true);
  assert(!JSON.stringify(profile).includes("private-test-value"));
  assert.equal(service.profile("b"), null);
  await assert.rejects(service.request("b", "hello"), /配置/);
  await service.save("a", {
    provider: "openai-compatible",
    endpoint: "https://example.com/v1",
    model: "fixture",
    token: "replacement-secret",
  });
  assert.equal(secrets.size, 1);
  assert.equal(
    (await service.request("a", "hello")).token,
    "replacement-secret",
  );
  db.close();
  const raw = readFileSync(path).toString();
  assert(!raw.includes("private-test-value"));
  assert(!raw.includes("replacement-secret"));
});

test("capability results are scoped, survive reload and expire when model changes", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "produck-capabilities-")), "db"),
    db = openProjectDatabase(path);
  for (const id of ["a", "b"])
    db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run(
      id,
      id,
      "/" + id,
      "now",
    );
  const service = new ModelService(db, {
    set: async () => {},
    get: async () => "synthetic",
    delete: async () => {},
  });
  const config = {
    provider: "openai-compatible" as const,
    endpoint: "https://example.com/v1",
    model: "fixture",
    token: "synthetic",
  };
  await service.save("a", config);
  assert.throws(() => service.requireCapability("a", "image"), /尚未通过/);
  await assert.rejects(
    service.request("a", "analyze", undefined, ["image"]),
    /文字重建/,
  );
  await service.probe(
    "a",
    (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
      )) as typeof fetch,
  );
  assert.equal(service.capabilities("a")?.text, "supported");
  assert.equal(service.capabilities("b"), null);
  service.requireCapability("a", "text");
  assert.throws(() => service.requireCapability("a", "tools"), /原生工具/);
  await service.save("a", { ...config, model: "new-model" });
  assert.equal(service.capabilities("a"), null);
  db.close();
});

test("catalog scopes saved credentials and reasoning survives reload and invalidates probes", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "produck-catalog-")), "db");
  let db = openProjectDatabase(path);
  db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run("a", "a", "/a", "now");
  const credentials = {
    set: async () => {},
    get: async () => "saved-secret",
    delete: async () => {},
  };
  let service = new ModelService(db, credentials);
  const config = {
    provider: "openai-compatible" as const,
    endpoint: "https://example.com/v1",
    model: "fixture",
  };
  await service.save("a", {
    ...config,
    token: "saved-secret",
    reasoningEffort: "high",
  });
  const transport: typeof fetch = async (url, init) => {
    assert.equal(url, config.endpoint + "/models");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer saved-secret",
    );
    assert.equal(init?.redirect, "error");
    return Response.json({
      data: [{ id: "z" }, { id: "a" }, { id: "z" }, {}, { id: 42 }],
    });
  };
  assert.deepEqual(await service.catalog("a", config, transport), ["a", "z"]);
  for (const changed of [
    { endpoint: "https://other.com/v1" },
    { provider: "anthropic" as const },
  ]) {
    await assert.rejects(
      service.catalog("a", { ...config, ...changed }, async () => {
        throw new Error("must not send");
      }),
      /填写当前服务/,
    );
  }
  db.close();
  db = openProjectDatabase(path);
  service = new ModelService(db, credentials);
  assert.equal(service.profile("a")?.reasoningEffort, "high");
  assert.equal((await service.request("a", "hello")).reasoningEffort, "high");
  await service.probe("a", async () =>
    Response.json({ choices: [{ message: { content: "OK" } }] }),
  );
  await service.save("a", { ...config, reasoningEffort: "low" });
  assert.equal(service.capabilities("a"), null);
  await assert.rejects(
    service.save("a", {
      ...config,
      provider: "anthropic",
      reasoningEffort: "high",
    }),
    /推理强度/,
  );
  db.close();
});
