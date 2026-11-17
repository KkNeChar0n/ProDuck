import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomicWrite,
  discardInterruptedWrites,
  projectPath,
  openProjectDatabase,
  migrations,
} from "../src/projects/storage.js";
const fixture = () => mkdtempSync(join(tmpdir(), "produck-storage-test-"));
test("interrupted write cleanup retains the last complete artifact", () => {
  const root = fixture(),
    file = join(root, "prototype.html");
  atomicWrite(file, "approved");
  writeFileSync(
    join(root, ".produck-write-00000000-0000-0000-0000-000000000000.tmp"),
    "incomplete",
  );
  assert.equal(discardInterruptedWrites(root), 1);
  assert.equal(readFileSync(file, "utf8"), "approved");
  atomicWrite(file, "candidate");
  assert.equal(readFileSync(file, "utf8"), "candidate");
});
test("project paths reject traversal, absolute and symlink escapes", () => {
  const root = fixture(),
    outside = fixture();
  symlinkSync(outside, join(root, "link"));
  assert.throws(() => projectPath(root, "../elsewhere"));
  assert.throws(() => projectPath(root, outside));
  assert.throws(() => projectPath(root, "link/secret"));
  assert.equal(
    projectPath(root, "documents/prd.md"),
    join(realpathSync(root), "documents/prd.md"),
  );
});
test("failed schema migration restores previous rows and version from backup", () => {
  const path = join(fixture(), "projects.sqlite");
  let db = openProjectDatabase(path);
  db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run(
    "p1",
    "项目 A",
    "/fixture/a",
    "2026-11-17",
  );
  db.close();
  assert.throws(() =>
    openProjectDatabase(path, [
      ...migrations,
      {
        version: migrations.at(-1)!.version + 1,
        sql: "ALTER TABLE projects ADD COLUMN extra TEXT; INVALID SQL;",
      },
    ]),
  );
  assert(existsSync(path + `.v${migrations.at(-1)!.version}.backup`));
  db = openProjectDatabase(path);
  assert.equal(
    db.prepare("SELECT name FROM projects WHERE id=?").get("p1")?.name,
    "项目 A",
  );
  assert.equal(
    db.prepare("PRAGMA user_version").get()?.user_version,
    migrations.at(-1)!.version,
  );
  assert(
    !db
      .prepare("PRAGMA table_info(projects)")
      .all()
      .some((c) => c.name === "extra"),
  );
  db.close();
});
test("schema enforces project references and supports pending remote results", () => {
  const db = openProjectDatabase(join(fixture(), "projects.sqlite"));
  assert.throws(() =>
    db
      .prepare("INSERT INTO task_runs VALUES(?,?,?,?)")
      .run("t", "missing", "running", "now"),
  );
  db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run(
    "p",
    "A",
    "/fixture/a",
    "now",
  );
  db.prepare("INSERT INTO task_runs VALUES(?,?,?,?)").run(
    "t",
    "p",
    "running",
    "now",
  );
  db.prepare("INSERT INTO step_runs VALUES(?,?,?,?,?)").run(
    "s",
    "t",
    "interrupted",
    null,
    null,
  );
  db.prepare("INSERT INTO sync_receipts VALUES(?,?,?,?,?,?)").run(
    "r",
    "s",
    "feishu",
    null,
    "unknown",
    "{}",
  );
  assert.equal(
    db.prepare("SELECT state FROM sync_receipts").get()?.state,
    "unknown",
  );
  db.close();
});

test("v1 database upgrades with a backup and preserves project rows", () => {
  const path = join(fixture(), "v1.sqlite");
  let db = openProjectDatabase(path, migrations.slice(0, 1));
  db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run(
    "old",
    "旧项目",
    "/old",
    "now",
  );
  db.close();
  db = openProjectDatabase(path);
  assert.equal(
    db.prepare("SELECT name FROM projects WHERE id='old'").get()?.name,
    "旧项目",
  );
  assert(existsSync(path + ".v1.backup"));
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM model_capabilities").get()?.n,
    0,
  );
  db.close();
});
