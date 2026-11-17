import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importSource, listSources } from "../src/projects/sources.js";
test("source import preserves evidence and provenance without executing HTML", () => {
  const root = mkdtempSync(join(tmpdir(), "produck-sources-"));
  mkdirSync(join(root, "sources"));
  const file = join(root, "handoff.html");
  writeFileSync(
    file,
    '<script>throw new Error("not executed")</script><h1>交接资料</h1>',
  );
  const record = importSource(root, file);
  assert.equal(record.name, "handoff.html");
  assert.equal(record.sha256.length, 64);
  assert.equal(listSources(root).length, 1);
  assert.match(
    readFileSync(join(root, record.relativePath), "utf8"),
    /交接资料/,
  );
});
test("unsupported or binary sources cannot enter the project index", () => {
  const root = mkdtempSync(join(tmpdir(), "produck-sources-"));
  mkdirSync(join(root, "sources"));
  writeFileSync(join(root, "binary.txt"), Buffer.from([0, 1, 2]));
  writeFileSync(join(root, "file.pdf"), "not a supported document");
  assert.throws(() => importSource(root, join(root, "binary.txt")), /二进制/);
  assert.throws(() => importSource(root, join(root, "file.pdf")), /转换/);
  assert.deepEqual(listSources(root), []);
});
