import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDatabase } from "../src/projects/storage.js";
import { ProjectRepository } from "./fixtures/legacy-projects.js";
import { SkillRepository } from "../src/skills/repository.js";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "produck-skills-")),
    db = openProjectDatabase(join(root, "db")),
    projects = new ProjectRepository(db, join(root, "state")),
    p = projects.create("A", root),
    b = projects.create("B", root),
    repo = new SkillRepository(projects),
    source = join(root, "skill");
  mkdirSync(source);
  return { root, db, projects, p, b, repo, source };
}
test("skills import instructions/resources, report mapped write permission and bind immutable version", () => {
  const f = fixture();
  mkdirSync(join(f.source, "references"));
  writeFileSync(
    join(f.source, "SKILL.md"),
    "---\nname: product-review\ndescription: >\n  Review product decisions\n  and list open questions.\nallowed-tools:\n  - Read\n  - Write\n---\nUse [template](references/template.md).",
  );
  writeFileSync(join(f.source, "references/template.md"), "# 风险与待确认问题");
  const skill = f.repo.import(f.p.id, f.source);
  assert.equal(skill.name, "product-review");
  assert.match(skill.description, /list open/);
  assert.equal(skill.status, "needs-approval");
  assert.equal(skill.resources.length, 2);
  assert.match(f.repo.instructions(f.p.id, skill.id).text, /风险/);
  assert.match(
    f.repo.instructions(f.p.id, skill.id).text,
    /Read → .*read_source/,
  );
  assert.match(
    f.repo.instructions(f.p.id, skill.id).text,
    /不支持任意路径读写/,
  );
  assert.throws(() => f.repo.instructions(f.b.id, skill.id), /不属于/);
  writeFileSync(
    join(f.p.workspace, `skills/${skill.id}/references/template.md`),
    "changed",
  );
  assert.throws(() => f.repo.instructions(f.p.id, skill.id), /变化/);
  f.db.close();
});
test("script and unadapted-host skills are blocked rather than claiming compatibility", () => {
  const f = fixture();
  writeFileSync(
    join(f.source, "SKILL.md"),
    "---\nname: script-skill\nallowed-tools: Bash AskUserQuestion\n---\nRun python3 helper.py",
  );
  writeFileSync(join(f.source, "helper.py"), 'print("hello")');
  const skill = f.repo.import(f.p.id, f.source);
  assert.equal(skill.status, "unsupported");
  assert(skill.reasons.some((r) => r.includes("脚本")));
  assert(skill.reasons.some((r) => r.includes("AskUserQuestion")));
  assert.throws(() => f.repo.instructions(f.p.id, skill.id), /未适配/);
  f.db.close();
});
test("relative traversal, symlinks and missing resources cannot silently enter a runnable skill", () => {
  const f = fixture();
  writeFileSync(join(f.source, "SKILL.md"), "[escape](../outside.md)");
  assert.throws(() => f.repo.import(f.p.id, f.source), /超出/);
  writeFileSync(join(f.source, "SKILL.md"), "[missing](references/no.md)");
  assert.equal(f.repo.import(f.p.id, f.source).status, "unsupported");
  symlinkSync(f.b.workspace, join(f.source, "outside"));
  assert.throws(() => f.repo.import(f.p.id, f.source), /符号链接/);
  f.db.close();
});
