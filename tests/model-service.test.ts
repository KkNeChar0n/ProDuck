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
