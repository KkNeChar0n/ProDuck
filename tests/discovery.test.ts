import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openProjectDatabase } from "../src/projects/storage.js";
import { ProjectRepository } from "./fixtures/legacy-projects.js";
import { saveCapture, searchPageMemory } from "../src/projects/captures.js";
import { importSource } from "../src/projects/sources.js";
import {
  DiscoveryService,
  renderUnderstanding,
} from "../src/discovery/service.js";
import { UnderstandingRepository } from "../src/discovery/repository.js";
import {
  requestAllowed,
  validateDiscoveryAction,
} from "../src/discovery/browser-policy.js";
import type {
  DiscoveryRun,
  DiscoveryPage,
} from "../src/contracts/discovery.js";
const page: DiscoveryPage = {
  title: "客户管理",
  url: "https://example.com/",
  text: "客户列表与筛选",
  structure: "[]",
  elements: [
    {
      index: 0,
      tag: "A",
      role: "",
      type: "",
      label: "客户",
      href: "https://example.com/customers",
    },
    { index: 1, tag: "BUTTON", role: "", type: "button", label: "删除客户" },
    { index: 2, tag: "INPUT", role: "", type: "search", label: "搜索客户" },
  ],
  fingerprint: "fixed",
  blocked: [],
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "produck-discovery-")),
    db = openProjectDatabase(join(root, "db"));
  const projects = new ProjectRepository(db, join(root, "state")),
    p = projects.create("A", root),
    other = projects.create("B", root);
  return { root, db, projects, p, other };
}
function output(run: DiscoveryRun) {
  return {
    overview: "产品管理客户",
    modules: [
      {
        name: "客户",
        understanding: "已观察客户列表；权限待验证",
        flows: ["搜索→结果"],
        evidenceIds: [run.captureIds[0]],
        unknowns: ["删除不在体验范围"],
      },
    ],
    conflicts: [],
    limitations: ["仅体验列表"],
  };
}
test("discovery policy rejects writes, cross-site navigation and unsafe input", () => {
  assert(
    requestAllowed(
      "https://example.com/list",
      "GET",
      "https://example.com",
      true,
    ),
  );
  assert(
    !requestAllowed(
      "https://example.com/query",
      "POST",
      "https://example.com",
      false,
    ),
  );
  assert(
    !requestAllowed("https://other.test/", "GET", "https://example.com", true),
  );
  assert(
    !requestAllowed(
      "https://example.com/delete/1",
      "GET",
      "https://example.com",
      true,
    ),
  );
  validateDiscoveryAction(
    page,
    { kind: "click", index: 0 },
    "https://example.com",
  );
  validateDiscoveryAction(
    page,
    { kind: "fill", index: 2, value: "test" },
    "https://example.com",
  );
  assert.throws(() =>
    validateDiscoveryAction(
      page,
      { kind: "click", index: 1 },
      "https://example.com",
    ),
  );
  assert.throws(() =>
    validateDiscoveryAction(
      page,
      { kind: "fill", index: 0, value: "test" },
      "https://example.com",
    ),
  );
  assert.throws(() =>
    validateDiscoveryAction(
      page,
      { kind: "click", index: 99 },
      "https://example.com",
    ),
  );
});
test("understanding approval binds exact report and evidence, revisions retain old active memory", () => {
  const { root, db, projects, p, other } = fixture(),
    repo = new UnderstandingRepository(projects);
  const c = saveCapture(
    p.workspace,
    {
      title: page.title,
      url: page.url,
      text: page.text,
      structure: "[]",
      actions: [],
      capturedAt: new Date().toISOString(),
    },
    new Uint8Array([1]),
    false,
  );
  assert.equal(searchPageMemory(p.workspace, "").length, 0);
  const run: DiscoveryRun = {
    id: crypto.randomUUID(),
    projectId: p.id,
    releaseId: p.id,
    url: page.url,
    goal: "",
    budget: 4,
    state: "draft",
    message: "",
    createdAt: new Date().toISOString(),
    captureIds: [c.id],
    steps: [],
    sources: [],
  };
  repo.saveRun(p.id, run);
  const report = repo.create(p.id, run, renderUnderstanding(output(run), run));
  assert.equal(repo.active(p.id), null);
  assert.throws(() => repo.get(p.id, report.id, report.digest, true));
  assert.throws(() => repo.approve(other.id, report.id, report.digest));
  assert.throws(() => repo.approve(p.id, report.id, "old"));
  assert.throws(() => repo.approve(p.id, report.id, ""));
  assert.throws(() => repo.approve(p.id, report.id, undefined as any));
  repo.approve(p.id, report.id, report.digest);
  const revised = repo.revise(
    p.id,
    report.id,
    report.digest,
    report.markdown + "\n人工补充规则",
  );
  assert.equal(repo.active(p.id)?.id, report.id);
  assert.equal(revised.approvedAt, undefined);
  const restarted = new UnderstandingRepository(projects);
  assert.equal(restarted.active(p.id)?.id, report.id);
  restarted.approve(p.id, revised.id, revised.digest);
  assert.equal(repo.active(p.id)?.id, revised.id);
  assert.throws(() =>
    renderUnderstanding(
      {
        ...output(run),
        modules: [{ ...output(run).modules[0], evidenceIds: ["invented"] }],
      },
      run,
    ),
  );
  writeFileSync(join(p.workspace, c.screenshotPath), "changed");
  assert.throws(() => repo.get(p.id, report.id), /依据已变化/);
  db.close();
});
test("automatic discovery combines handoff evidence, preserves cancellation and resumes without replay", async () => {
  const { root, db, projects, p } = fixture();
  writeFileSync(
    join(root, "handoff.md"),
    "证书自动化 SaaS 交接：客户模块用于组织购买记录。",
  );
  importSource(p.workspace, join(root, "handoff.md"));
  let actions = 0,
    manual = 0,
    stepCalls = 0;
  const browser = {
    open: async () => {},
    begin: async () => page.url,
    observe: async () => ({ ...page, png: new Uint8Array([1]) }),
    action: async () => {
      actions++;
    },
    manual: async () => {
      manual++;
    },
    close: () => {},
  };
  let service: DiscoveryService;
  service = new DiscoveryService(projects, browser, async (_scope, prompt) => {
    assert(prompt.includes("证书自动化"));
    if (prompt.startsWith("PRODUCK_DISCOVERY_STEP")) {
      stepCalls++;
      if (stepCalls === 1) throw new Error("模拟断网");
      return JSON.stringify({
        observation: "客户模块包含筛选",
        action: { kind: "finish", reason: "已观察列表" },
      });
    }
    return JSON.stringify(output(service.state(p.id).run!));
  });
  const first = await service.start(p.id, "理解产品", 4);
  async function settled() {
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 10));
      const s = service.state(p.id);
      if (s.run?.state !== "running") return s;
    }
    throw new Error("timeout");
  }
  let state = await settled();
  assert.equal(state.run?.state, "paused");
  assert.equal(state.run?.captureIds.length, 1);
  assert.equal(actions, 0);
  await service.resume(p.id, first.id);
  state = await settled();
  assert.equal(state.run?.state, "draft");
  assert.equal(state.run?.captureIds.length, 2);
  assert.equal(actions, 0);
  assert.equal(manual, 2);
  assert.equal(state.activeReportId, null);
  assert(state.reports[0].markdown.includes("handoff.md"));
  await service.close();
  db.close();
});

test("cancelling discovery aborts the model and keeps evidence without approving memory", async () => {
  const { db, projects, p } = fixture();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let released = 0;
  const browser = {
    open: async () => {},
    begin: async () => page.url,
    observe: async () => ({ ...page, png: new Uint8Array([1]) }),
    action: async () => {
      throw new Error("must not run");
    },
    manual: async () => {
      released++;
    },
    close: () => {},
  };
  const service = new DiscoveryService(
    projects,
    browser,
    async (_id, _prompt, signal) => {
      entered();
      return new Promise<string>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        }),
      );
    },
  );
  await service.start(p.id, "理解", 4);
  await started;
  await service.cancel(p.id);
  const result = service.state(p.id);
  assert.equal(result.run?.state, "paused");
  assert.equal(result.run?.captureIds.length, 1);
  assert.equal(result.activeReportId, null);
  assert.equal(released, 1);
  await service.close();
  db.close();
});
