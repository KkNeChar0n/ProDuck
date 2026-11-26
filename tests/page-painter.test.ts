import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pageRegions,
  assembleRegions,
  PagePainter,
} from "../src/prototypes/page-painter.js";
import { ProjectRepository } from "./fixtures/legacy-projects.js";
import { openProjectDatabase } from "../src/projects/storage.js";
import { PrototypeRepository } from "../src/prototypes/repository.js";
import { saveCapture } from "../src/projects/captures.js";
import type { DiscoveryRun } from "../src/contracts/discovery.js";
const html = (label: string) =>
  `<!doctype html><html><head><style>button{color:red}</style></head><body><button id="r0_button">${label}</button><script>document.querySelector('button').onclick=()=>document.querySelector('button').textContent='clicked';</script></body></html>`;
const large = Array.from(
  { length: 40 },
  (_, i) => `<section><h2>模块${i}</h2><p>${"内容".repeat(300)}</p></section>`,
).join("");
function setup() {
  const root = mkdtempSync(join(tmpdir(), "produck-paint-"));
  const db = openProjectDatabase(join(root, "db"));
  const projects = new ProjectRepository(db, join(root, "state"));
  const project = projects.create("A", root);
  const versions = new PrototypeRepository(db, projects);
  const capture = saveCapture(
    project.workspace,
    {
      title: "页面",
      url: "https://example.com/a",
      html: `<html><body>${large}</body></html>`,
      text: "页面",
      structure: "[]",
      actions: [],
      capturedAt: new Date().toISOString(),
    },
    new Uint8Array(),
    false,
  );
  const run = {
    id: "run",
    projectId: project.id,
    releaseId: project.id,
    goal: "了解模块",
    captureIds: [capture.id],
    steps: [
      {
        captureId: capture.id,
        module: "A",
        observation: "页面",
        result: "已观察",
      },
    ],
    pageTasks: [],
  } as unknown as DiscoveryRun;
  return {
    root,
    db,
    projects,
    project,
    versions,
    capture,
    run,
    close() {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("large DOM splits into bounded regions retaining all semantic text", () => {
  const parts = pageRegions({
    html: `<html><body><main>${large}</main></body></html>`,
    text: "",
    structure: "[]",
  });
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => JSON.stringify(p).length <= 10000));
  for (let i = 0; i < 40; i++) assert.ok(parts.join("").includes(`模块${i}`));
  assert.ok(
    pageRegions({ text: "x".repeat(50000), structure: "", html: undefined })
      .length > 1,
  );
});
test("region assembly keeps controls, scopes selectors and isolates scripts", () => {
  const output = assembleRegions("页面", [html("A"), html("B")]);
  assert.match(output, /@scope \(#produck-region-0\)/);
  assert.match(output, /root.querySelector.bind/);
  assert.match(output, /produck-region-1/);
  assert.match(output, />A<\/button>/);
  assert.match(output, />B<\/button>/);
});
test("failed page resumes only unfinished regions and cannot cross release boundaries", async () => {
  const f = setup();
  try {
    let calls = 0,
      fail = true;
    const painter = new PagePainter(f.projects, f.versions, async (prompt) => {
      calls++;
      assert.ok(prompt.length <= 16000);
      if (calls === 2 && fail) throw new Error("鉴权失败");
      return html(`区域${calls}`);
    });
    await assert.rejects(
      painter.paint(
        f.project.id,
        f.run,
        f.capture.id,
        new AbortController().signal,
        () => {},
      ),
      /鉴权/,
    );
    assert.equal(f.run.pageTasks![0].parts[0].state, "done");
    assert.equal(f.run.pageTasks![0].state, "failed");
    const n = f.run.pageTasks![0].parts.length;
    fail = false;
    const version = await painter.paint(
      f.project.id,
      f.run,
      f.capture.id,
      new AbortController().signal,
      () => {},
    );
    assert.equal(calls, n + 1);
    assert.equal(f.run.pageTasks![0].state, "done");
    assert.ok(f.versions.read(f.project.id, version).includes("区域1"));
    await painter.paint(
      f.project.id,
      f.run,
      f.capture.id,
      new AbortController().signal,
      () => {},
    );
    assert.equal(calls, n + 1);
    await assert.rejects(
      painter.paint(
        "foreign",
        f.run,
        f.capture.id,
        new AbortController().signal,
        () => {},
      ),
      /不属于/,
    );
  } finally {
    f.close();
  }
});
test("truncated region automatically subdivides, cancellation preserves finished parts", async () => {
  const f = setup();
  try {
    let calls = 0;
    const painter = new PagePainter(f.projects, f.versions, async () => {
      calls++;
      if (calls === 1) return "<html>incomplete";
      return html("done");
    });
    const initial = pageRegions(f.capture).length;
    await painter.paint(
      f.project.id,
      f.run,
      f.capture.id,
      new AbortController().signal,
      () => {},
    );
    assert.ok(f.run.pageTasks![0].parts.length > initial);
    assert.ok(f.run.pageTasks![0].parts.every((p) => p.state === "done"));
    const controller = new AbortController();
    controller.abort();
    const next = { ...structuredClone(f.run), pageTasks: [] };
    await assert.rejects(
      painter.paint(
        f.project.id,
        next,
        f.capture.id,
        controller.signal,
        () => {},
      ),
    );
    assert.equal(next.pageTasks[0].state, "failed");
  } finally {
    f.close();
  }
});
