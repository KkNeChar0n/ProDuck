import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { openProjectDatabase } from "../src/projects/storage.js";
import { ProjectRepository } from "./fixtures/legacy-projects.js";
import { SkillRepository } from "../src/skills/repository.js";
import { parsePythonManifest } from "../src/skills/python-manifest.js";
import { PythonRunner } from "../src/skills/python-runner.js";
const manifest = {
  runtime: "python3.12",
  entry: "main.py",
  dependencies: [],
  capabilities: { read: "skill", write: "output", network: false },
};
test("Python declarations reject dependencies, broader access and escaping entry paths", () => {
  assert.equal(parsePythonManifest(JSON.stringify(manifest)).entry, "main.py");
  for (const change of [
    { entry: "../main.py" },
    { dependencies: ["requests"] },
    { capabilities: { ...manifest.capabilities, network: true } },
    { capabilities: { ...manifest.capabilities, read: "workspace" } },
    { extra: true },
  ])
    assert.throws(() =>
      parsePythonManifest(JSON.stringify({ ...manifest, ...change })),
    );
});
test(
  "Python sandbox permits isolated results and denies outside reads, networking and subprocesses",
  { skip: process.env.PRODUCK_TEST_PYTHON !== "1" },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "produck-python-test-")),
      db = openProjectDatabase(join(root, "db")),
      projects = new ProjectRepository(db, join(root, "state")),
      p = projects.create("Python", root),
      skills = new SkillRepository(projects),
      source = join(root, "skill");
    mkdirSync(source);
    const server = createServer((s) => s.destroy());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    t.after(() => {
      server.close();
      db.close();
      rmSync(root, { recursive: true, force: true });
    });
    const outside = join(root, "private.txt");
    writeFileSync(outside, "DO_NOT_READ");
    writeFileSync(
      join(source, "SKILL.md"),
      "---\nname: python-isolation\n---\n处理输入并生成本地结果。",
    );
    writeFileSync(
      join(source, "produck-python.json"),
      JSON.stringify(manifest),
    );
    const port = (server.address() as { port: number }).port;
    writeFileSync(
      join(source, "main.py"),
      `import json,sys,socket,subprocess,os\ndata=json.load(sys.stdin)\nopen('result.json','w').write(json.dumps(data))\nfor name, action in [('read',lambda:open(${JSON.stringify(outside)}).read()),('write',lambda:open(${JSON.stringify(outside)},'w').write('changed')),('network',lambda:socket.create_connection(('127.0.0.1',${port}),timeout=1)),('process',lambda:subprocess.run(['/usr/bin/true']))]:\n try:\n  action()\n  print(name+':ALLOWED')\n except PermissionError:\n  print(name+':DENIED')\nprint('RESULT_OK')\n`,
    );
    const skill = skills.import(p.id, source);
    assert.equal(skill.status, "needs-approval");
    assert(skill.python);
    const runner = new PythonRunner(projects, skills, resolve("dist/python"));
    const result = await runner.run(
      p.id,
      skill.id,
      skill.fingerprint,
      '{"value":42}',
    );
    assert.equal(result.state, "succeeded", result.output);
    assert.match(result.output, /RESULT_OK/);
    for (const kind of ["read", "write", "network", "process"])
      assert.match(result.output, new RegExp(kind + ":DENIED"));
    assert.deepEqual(
      JSON.parse(
        readFileSync(
          join(p.workspace, result.relativePath, "output/result.json"),
          "utf8",
        ),
      ),
      { value: 42 },
    );
    assert.equal(readFileSync(outside, "utf8"), "DO_NOT_READ");
    await assert.rejects(
      new PythonRunner(projects, skills, join(root, "missing-python")).run(
        p.id,
        skill.id,
        skill.fingerprint,
        "{}",
      ),
      /运行资源缺失/,
    );
    writeFileSync(join(source, "main.py"), "import time\ntime.sleep(60)\n");
    const sleeping = skills.import(p.id, source),
      pending = runner.run(p.id, sleeping.id, sleeping.fingerprint, "{}");
    setTimeout(() => runner.cancel(p.id), 100);
    const cancelled = await pending;
    assert.equal(cancelled.state, "failed");
    assert.match(cancelled.message, /取消/);
    writeFileSync(join(source, "main.py"), "print('x'*100000)\n");
    const verbose = skills.import(p.id, source),
      limited = await runner.run(p.id, verbose.id, verbose.fingerprint, "{}");
    assert.equal(limited.state, "failed");
    assert.match(limited.message, /输出超过/);
    writeFileSync(
      join(source, "main.py"),
      "import os\nos.symlink('/etc/passwd','escape')\n",
    );
    const linked = skills.import(p.id, source),
      blocked = await runner.run(p.id, linked.id, linked.fingerprint, "{}");
    assert.equal(blocked.state, "failed");
    await assert.rejects(
      runner.run(p.id, linked.id, skill.fingerprint, "{}"),
      /版本/,
    );
    writeFileSync(
      join(source, "produck-python.json"),
      JSON.stringify({ ...manifest, dependencies: ["requests"] }),
    );
    assert.equal(skills.import(p.id, source).status, "unsupported");
    writeFileSync(
      join(source, "produck-python.json"),
      JSON.stringify(manifest),
    );

    writeFileSync(
      join(p.workspace, `skills/${skill.id}/main.py`),
      "print('changed')",
    );
    await assert.rejects(
      runner.run(p.id, skill.id, skill.fingerprint, "{}"),
      /变化/,
    );
    const changed = skills.import(p.id, source);
    await assert.rejects(
      runner.run(p.id, changed.id, skill.fingerprint + "invalid", "{}"),
      /版本/,
    );
  },
);
