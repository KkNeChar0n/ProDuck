import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runtimeManifest,
  verifyRuntime,
} from "../scripts/runtime-manifest.mjs";
test("packaged runtime inventory detects changed, missing and unexpected files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "produck-manifest-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "dist"));
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "LICENSE"), "license");
  writeFileSync(join(root, "dist/main.js"), "original");
  const manifest = runtimeManifest(root, { electron: "fixture" });
  assert.equal(verifyRuntime(root, manifest), 2);
  writeFileSync(join(root, "dist/main.js"), "modified");
  assert.throws(() => verifyRuntime(root, manifest), /不一致/);
  writeFileSync(join(root, "dist/main.js"), "original");
  writeFileSync(join(root, "node_modules/unexpected.js"), "extra");
  assert.throws(() => verifyRuntime(root, manifest), /不一致/);
  rmSync(join(root, "node_modules/unexpected.js"));
  rmSync(join(root, "dist/main.js"));
  assert.throws(() => verifyRuntime(root, manifest), /不一致/);
});
