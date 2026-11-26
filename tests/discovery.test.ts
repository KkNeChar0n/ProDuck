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
  actionConfirmation,
  businessActionIdentity,
  requestAllowed,
  validateDiscoveryAction,
} from "../src/discovery/browser-policy.js";
import type {
  DiscoveryRun,
  DiscoveryPage,
} from "../src/contracts/discovery.js";

function moduleReply(prompt: string) {
  const payload = JSON.parse(prompt.split("模块资料：")[1]);
  return JSON.stringify({
    understanding: "模块职责与页面规则来自已观察资料",
    flows: ["查看入口→体验流程→核对结果"],
    unknowns: ["尚有未覆盖分支"],
    evidenceIds: [payload.evidence[0].id],
  });
}
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
test("discovery policy permits ordinary controls and POST queries while requiring write confirmation", () => {
  assert(
    requestAllowed(
      "https://example.com/list",
      "GET",
      "https://example.com",
      true,
    ),
  );
  assert(
    requestAllowed(
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
  assert(actionConfirmation(page, { kind: "click", index: 1 }));
  const sidebar = {
    ...page,
    elements: [
      {
        index: 0,
        tag: "BUTTON",
        role: "",
        type: "button",
        label: "切换侧边栏",
      },
    ],
  };
  validateDiscoveryAction(
    sidebar,
    { kind: "click", index: 0 },
    "https://example.com",
  );
  assert.equal(actionConfirmation(sidebar, { kind: "click", index: 0 }), null);
  assert(
    actionConfirmation(sidebar, { kind: "click", index: 0, effect: "unknown" }),
  );
  assert(
    !requestAllowed(
      "https://example.com/resource",
      "DELETE",
      "https://example.com",
      false,
    ),
  );
  assert(
    requestAllowed(
      "https://example.com/resource",
      "DELETE",
      "https://example.com",
      false,
      true,
    ),
  );
  assert(
    !requestAllowed(
      "https://example.com/graphql",
      "POST",
      "https://example.com",
      false,
      false,
      '{"query":"mutation { removeItem }"}',
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
    if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE"))
      return moduleReply(prompt);
    assert(prompt.includes("证书自动化"));
    if (prompt.startsWith("PRODUCK_DISCOVERY_STEP")) {
      stepCalls++;
      if (stepCalls === 1) throw new Error("模拟鉴权失败");
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
  assert.equal(state.run?.captureIds.length, 4);
  assert.equal(state.run?.finishCorrections, 2);
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

test("ordinary action failures re-observe and continue without manual intervention", async () => {
  const { db, projects, p } = fixture();
  let decisions = 0,
    actions = 0;
  const browser = {
    open: async () => {},
    begin: async () => page.url,
    observe: async () => ({ ...page, png: new Uint8Array([1]) }),
    action: async () => {
      actions++;
      if (actions === 1) throw new Error("元素已变化");
    },
    manual: async () => {},
    close: () => {},
  };
  let service: DiscoveryService;
  service = new DiscoveryService(projects, browser, async (_id, prompt) => {
    if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE"))
      return moduleReply(prompt);
    if (prompt.startsWith("PRODUCK_DISCOVERY_REPORT"))
      return JSON.stringify(output(service.state(p.id).run!));
    decisions++;
    if (decisions === 2) assert(prompt.includes("元素已变化"));
    return JSON.stringify({
      observation: "导航",
      action:
        decisions === 3
          ? { kind: "finish", reason: "已完成" }
          : { kind: "click", index: 0, effect: "read" },
    });
  });
  await service.start(p.id, "自主探索", 5);
  for (let i = 0; i < 100 && service.state(p.id).run?.state === "running"; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(service.state(p.id).run?.state, "draft");
  assert.equal(actions, 2);
  assert(service.state(p.id).run!.steps[0].result.includes("重新观察"));
  await service.close();
  db.close();
});

test("business actions are not replayed after a paused task resumes", async () => {
  const { db, projects, p } = fixture();
  let decisions = 0,
    actions = 0;
  const browser = {
    open: async () => {},
    begin: async () => page.url,
    observe: async () => ({ ...page, png: new Uint8Array([1]) }),
    action: async () => {
      actions++;
    },
    manual: async () => {},
    close: () => {},
  };
  let service: DiscoveryService;
  service = new DiscoveryService(projects, browser, async (_id, prompt) => {
    if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE"))
      return moduleReply(prompt);
    if (prompt.startsWith("PRODUCK_DISCOVERY_REPORT"))
      return JSON.stringify(output(service.state(p.id).run!));
    decisions++;
    if (decisions === 2) throw new Error("模拟鉴权失败");
    return JSON.stringify({
      observation: "业务操作",
      action:
        decisions === 4
          ? { kind: "finish", reason: "继续其他入口" }
          : { kind: "click", index: 1, effect: "write" },
    });
  });
  const run = await service.start(p.id, "自主体验", 6);
  async function settle() {
    for (
      let i = 0;
      i < 100 && service.state(p.id).run?.state === "running";
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
  }
  await settle();
  assert.equal(service.state(p.id).run?.state, "paused");
  assert.equal(actions, 1);
  const beforeCount = service.state(p.id).run!.captureIds.length;
  assert.equal(service.state(p.id).reports.length, 0);
  const resumed = await service.continueExploration(p.id, run.id, 60);
  assert.equal(resumed.roundStart, beforeCount);
  assert.equal(resumed.budget, beforeCount + 60);

  await settle();
  assert.equal(service.state(p.id).run?.state, "draft");
  assert.equal(actions, 1);
  await service.close();
  db.close();
});

const formPage: DiscoveryPage = {
  ...page,
  elements: [
    {
      index: 0,
      tag: "INPUT",
      role: "",
      type: "text",
      label: "客户名称",
      inForm: true,
    },
    {
      index: 1,
      tag: "BUTTON",
      role: "",
      type: "submit",
      label: "保存",
      inForm: true,
      submitsForm: true,
    },
  ].map((e) => ({
    ...e,
    form: {
      key: "#customer-form",
      action: "https://example.com/",
      method: "get",
      search: false,
      submitLabels: ["保存"],
      sensitive: false,
      valid: true,
      noValidate: false,
    },
  })),
};
test("search classification uses host evidence, while business identity spans submit buttons and Enter", () => {
  const query: DiscoveryPage = {
    ...formPage,
    elements: formPage.elements.map((e) => ({
      ...e,
      label: e.index === 0 ? "搜索客户" : "搜索",
      form: { ...e.form!, search: true, submitLabels: ["搜索"] },
    })),
  };
  assert.equal(
    actionConfirmation(query, { kind: "click", index: 1, effect: "read" }),
    null,
  );
  assert.equal(
    actionConfirmation(query, {
      kind: "press",
      index: 0,
      key: "Enter",
      effect: "read",
    }),
    null,
  );
  assert(
    actionConfirmation(query, { kind: "click", index: 1, effect: "write" }),
  );
  assert(
    actionConfirmation(formPage, {
      kind: "press",
      index: 0,
      key: "Enter",
      effect: "read",
    }),
  );
  assert.equal(
    businessActionIdentity(formPage, { kind: "click", index: 1 }),
    businessActionIdentity(formPage, { kind: "press", index: 0, key: "Enter" }),
  );
  const unsafe = {
    ...query,
    elements: query.elements.map((e) => ({
      ...e,
      form: { ...e.form!, action: "https://example.com/delete/1" },
    })),
  };
  assert(
    actionConfirmation(unsafe, { kind: "click", index: 1, effect: "read" }),
  );
});
test("no-dispatch validation permits later submission; persisted intent blocks alternative entry after resume", async () => {
  const { db, projects, p } = fixture();
  let decisions = 0,
    actions = 0;
  const browser = {
    open: async () => {},
    begin: async () => page.url,
    observe: async () => ({ ...formPage, png: new Uint8Array([1]) }),
    action: async () => {
      actions++;
      if (actions === 1) return { status: "validation-blocked" as const };
    },
    manual: async () => {},
    close: () => {},
  };
  let service: DiscoveryService;
  service = new DiscoveryService(projects, browser, async (_id, prompt) => {
    if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE"))
      return moduleReply(prompt);
    if (prompt.startsWith("PRODUCK_DISCOVERY_REPORT"))
      return JSON.stringify(output(service.state(p.id).run!));
    decisions++;
    if (decisions === 3) throw new Error("模拟鉴权失败");
    return JSON.stringify({
      observation: "表单",
      action:
        decisions === 5
          ? { kind: "finish", reason: "已记录" }
          : decisions === 4
            ? { kind: "press", index: 0, key: "Enter", effect: "write" }
            : { kind: "click", index: 1, effect: "write" },
    });
  });
  const run = await service.start(p.id, "验证表单", 8);
  const settle = async () => {
    for (
      let i = 0;
      i < 100 && service.state(p.id).run?.state === "running";
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
  };
  await settle();
  assert.equal(service.state(p.id).run?.state, "paused");
  assert.equal(actions, 2);
  assert.equal(service.state(p.id).run!.steps[0].businessActionKey, undefined);
  assert(
    service.state(p.id).run!.steps[1].businessActionKey?.startsWith("v3:"),
  );
  await service.resume(p.id, run.id);
  await settle();
  assert.equal(service.state(p.id).run?.state, "draft");
  assert.equal(actions, 2);
  await service.close();
  db.close();
});

test("continue exploration preserves approved evidence, inherits coverage and cannot replay business writes", async () => {
  const { db, projects, p, other } = fixture();
  let actions = 0;
  const browser = {
    open: async () => {},
    begin: async () => page.url,
    observe: async () => ({ ...page, png: new Uint8Array([1]) }),
    action: async () => {
      actions++;
    },
    manual: async () => {},
    close: () => {},
  };
  let service: DiscoveryService;
  service = new DiscoveryService(projects, browser, async (_id, prompt) => {
    if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE"))
      return moduleReply(prompt);
    if (prompt.startsWith("PRODUCK_DISCOVERY_REPORT"))
      return JSON.stringify(output(service.state(p.id).run!));
    return JSON.stringify({
      observation: "业务操作",
      module: "客户",
      flow: "edit",
      action: { kind: "click", index: 1, effect: "write" },
    });
  });
  const settle = async () => {
    for (
      let i = 0;
      i < 200 && service.state(p.id).run?.state === "running";
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
  };
  const initial = await service.start(p.id, "理解", 2);
  await settle();
  const original = service.memory.run(p.id, initial.id);
  const report = service.state(p.id).reports[0];
  const revised = service.memory.revise(
    p.id,
    report.id,
    report.digest,
    report.markdown + "\n人工补充保留",
  );
  service.memory.approve(p.id, revised.id, revised.digest);
  const originalBytes = JSON.stringify(original);
  await assert.rejects(service.continueExploration(other.id, initial.id, 40));
  await assert.rejects(service.continueExploration(p.id, initial.id, 121));
  const next = await service.continueExploration(p.id, initial.id, 120);
  assert.notEqual(next.id, initial.id);
  assert.equal(next.continuedFrom, initial.id);
  assert.equal(next.previousReportId, revised.id);
  assert.equal(next.roundStart, 2);
  assert.equal(next.budget, 122);
  assert.deepEqual(next.captureIds.slice(0, 2), original.captureIds);
  assert.deepEqual(next.coverage, original.coverage);
  assert.equal(next.reportId, undefined);
  await assert.rejects(
    service.continueExploration(p.id, initial.id, 40),
    /已有理解任务/,
  );
  await settle();
  assert.equal(service.state(p.id).run?.state, "draft");
  assert.equal(actions, 1);
  assert.equal(
    JSON.stringify(service.memory.run(p.id, initial.id)),
    originalBytes,
  );
  assert.equal(service.memory.active(p.id)?.id, revised.id);
  assert(
    service.memory
      .get(p.id, revised.id, revised.digest, true)
      .markdown.includes("人工补充保留"),
  );
  assert(
    service.state(p.id).run!.captureIds.length > original.captureIds.length,
  );
  const nextReport = service
    .state(p.id)
    .reports.find((r) => r.runId === next.id)!;
  assert.equal(nextReport.approvedAt, undefined);
  service.memory.approve(p.id, nextReport.id, nextReport.digest);
  assert.equal(service.memory.active(p.id)?.id, nextReport.id);
  await service.close();
  db.close();
});

test("drag exploration passes screenshot evidence and preserves before/after observations without inventing success", async () => {
  const { db, projects, p } = fixture();
  let dragged = false;
  const dragPage: DiscoveryPage = {
    ...page,
    elements: [
      {
        index: 0,
        key: "#resource",
        tag: "DIV",
        role: "",
        type: "",
        label: "资源",
        dragHint: true,
      },
      {
        index: 1,
        key: "#canvas",
        tag: "CANVAS",
        role: "",
        type: "",
        label: "画布",
      },
    ],
  };
  const browser = {
    open: async () => {},
    begin: async () => page.url,
    observe: async () => ({
      ...dragPage,
      text: dragged ? "节点新增，属性面板显示配置" : "空画布",
      png: new Uint8Array([1]),
    }),
    action: async (
      _id: string,
      _page: DiscoveryPage,
      action: import("../src/contracts/discovery.js").DiscoveryAction,
    ) => {
      assert.equal(action.kind, "drag");
      dragged = true;
    },
    manual: async () => {},
    close: () => {},
  };
  let service: DiscoveryService;
  service = new DiscoveryService(
    projects,
    browser,
    async (_id, prompt, _signal, image) => {
      if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE"))
        return moduleReply(prompt);
      if (prompt.startsWith("PRODUCK_DISCOVERY_REPORT")) {
        assert(prompt.includes('"kind":"drag"'));
        assert(prompt.includes("节点新增"));
        return JSON.stringify(output(service.state(p.id).run!));
      }
      assert.match(prompt, /drag\(index,targetIndex/);
      assert(image);
      if (dragged) {
        assert(prompt.includes("节点新增"));
        return JSON.stringify({
          observation: "观察到新增节点及属性配置",
          action: { kind: "finish", reason: "已验证拖拽" },
        });
      }
      return JSON.stringify({
        observation: "空画布",
        action: { kind: "drag", index: 0, targetIndex: 1, effect: "write" },
      });
    },
  );
  await service.start(p.id, "验证拖拽", 3);
  for (let i = 0; i < 100 && service.state(p.id).run?.state === "running"; i++)
    await new Promise((r) => setTimeout(r, 10));
  const run = service.state(p.id).run!;
  assert.equal(run.state, "draft");
  assert.equal(run.steps[0].executed, true);
  assert.equal(run.steps[0].submitted, false);
  assert(run.steps[0].businessActionKey);
  assert.equal(run.steps[1].observation, "观察到新增节点及属性配置");
  await service.close();
  db.close();
});

test("module completion summarizes before the next module acts, then budget end summarizes the last module", async () => {
  const { db, projects, p } = fixture();
  const order: string[] = [];
  let decisions = 0;
  const browser = {
    open: async () => {},
    begin: async () => page.url,
    observe: async () => ({ ...page, png: new Uint8Array([1]) }),
    action: async () => {
      order.push("action-orders");
    },
    manual: async () => {},
    close: () => {},
  };
  let service: DiscoveryService;
  service = new DiscoveryService(projects, browser, async (_id, prompt) => {
    if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE")) {
      const data = JSON.parse(prompt.split("模块资料：")[1]);
      order.push("summary-" + data.name);
      return moduleReply(prompt);
    }
    if (prompt.startsWith("PRODUCK_DISCOVERY_REPORT")) {
      assert(prompt.includes("模块阶段整理"));
      return JSON.stringify(output(service.state(p.id).run!));
    }
    decisions++;
    if (decisions === 1)
      return JSON.stringify({
        module: "客户",
        modulePlan: ["客户", "订单", "报表"],
        observation: "客户已观察",
        action: { kind: "complete-module", reason: "权限分支待补充" },
      });
    return JSON.stringify({
      module: "订单",
      observation: "订单已观察",
      action: { kind: "click", index: 0, effect: "read" },
    });
  });
  await service.start(p.id, "逐模块体验", 3);
  for (let i = 0; i < 100 && service.state(p.id).run?.state === "running"; i++)
    await new Promise((r) => setTimeout(r, 10));
  const state = service.state(p.id);
  assert.equal(state.run?.state, "draft");
  assert.deepEqual(order, ["summary-客户", "action-orders", "summary-订单"]);
  assert.equal(
    state.run!.modules!.find((m) => m.name === "报表")!.state,
    "pending",
  );
  assert(state.reports[0].markdown.includes("自动整理的模块记录"));
  assert.equal(state.activeReportId, null);
  await service.close();
  db.close();
});

test("long discovery contexts stay bounded across planning, module summary and final report", async () => {
  const { root, db, projects, p } = fixture();
  for (let i = 0; i < 12; i++) {
    const file = join(root, `handoff-${i}.md`);
    writeFileSync(file, "# 项目资料\n" + "很长的模块背景资料。".repeat(3000));
    importSource(p.workspace, file);
  }
  const largePage = {
    ...page,
    text: "页面内容".repeat(10000),
    elements: Array.from({ length: 220 }, (_, i) => ({
      index: i,
      tag: "BUTTON",
      role: "button",
      type: "button",
      label: "长字段".repeat(150),
      form: {
        key: "x".repeat(200),
        action: page.url,
        method: "get",
        search: false,
        submitLabels: ["保存"],
        sensitive: false,
        valid: true,
        noValidate: false,
      },
    })),
  };
  const browser = {
    open: async () => {},
    begin: async () => page.url,
    observe: async () => ({ ...largePage, png: new Uint8Array([1]) }),
    action: async () => {},
    manual: async () => {},
    close: () => {},
  };
  const sizes: number[] = [];
  let service: DiscoveryService;
  service = new DiscoveryService(projects, browser, async (_id, prompt) => {
    sizes.push(prompt.length);
    assert(prompt.length < 49000, `prompt ${prompt.length}`);
    if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE"))
      return moduleReply(prompt);
    if (prompt.startsWith("PRODUCK_DISCOVERY_REPORT"))
      return JSON.stringify(output(service.state(p.id).run!));
    const current = JSON.parse(prompt.split("页面证据：")[1]);
    assert(current.elements.length > 0);
    return JSON.stringify({
      module: "客户",
      observation: "已观察",
      action: { kind: "finish", reason: "本轮预算不足" },
    });
  });
  await service.start(p.id, "长任务", 3);
  for (let i = 0; i < 200 && service.state(p.id).run?.state === "running"; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(service.state(p.id).run?.state, "draft");
  assert(sizes.length >= 3);
  await service.close();
  db.close();
});

test("discovery recovers malformed model output in the same captured step", async () => {
  const { db, projects, p } = fixture();
  let calls = 0;
  let service: DiscoveryService;
  service = new DiscoveryService(
    projects,
    {
      open: async () => {},
      begin: async () => page.url,
      observe: async () => ({ ...page, png: new Uint8Array([1]) }),
      action: async () => {
        assert.fail("finish must not dispatch an action");
      },
      manual: async () => {},
      close: () => {},
    },
    async (_scope, prompt) => {
      if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE"))
        return moduleReply(prompt);
      if (prompt.startsWith("PRODUCK_DISCOVERY_REPORT"))
        return JSON.stringify(output(service.state(p.id).run!));
      if (++calls === 1) return "broken JSON";
      return JSON.stringify({
        observation: "已观察",
        action: { kind: "finish", reason: "无可用测试数据" },
      });
    },
  );
  try {
    await service.start(p.id, "观察", 2);
    for (
      let i = 0;
      i < 400 && service.state(p.id).run?.state === "running";
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    const run = service.state(p.id).run!;
    assert.equal(run.state, "draft");
    assert.equal(run.retries?.length, 1);
    assert.equal(run.retries?.[0].attempt, 1);
    assert.equal(run.captureIds.length, 2);
    assert.equal(calls, 3);
    assert.equal(run.stopReason, "无可用测试数据");
  } finally {
    await service.close();
    db.close();
  }
});

test("actual feature backlog prevents early finish and continuation inherits discovered goals without altering old report", async () => {
  const { db, projects, p } = fixture();
  let calls = 0;
  let service: DiscoveryService;
  service = new DiscoveryService(
    projects,
    {
      open: async () => {},
      begin: async () => page.url,
      observe: async () => ({ ...page, png: new Uint8Array([1]) }),
      action: async () => {
        assert.fail("finish is not a browser action");
      },
      manual: async () => {},
      close: () => {},
    },
    async (_id, prompt) => {
      if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE"))
        return moduleReply(prompt);
      if (prompt.startsWith("PRODUCK_DISCOVERY_REPORT"))
        return JSON.stringify(output(service.state(p.id).run!));
      calls++;
      if (calls > 1) assert(prompt.includes("核对列表字段"));
      const id = service.state(p.id).run!.captureIds.at(-1)!;
      return JSON.stringify({
        module: "客户",
        observation: "客户列表",
        features: [
          {
            module: "客户",
            name: "列表字段展示",
            goal: "核对列表字段",
            state: calls === 1 ? "pending" : "verified",
            result: calls === 1 ? "发现列表" : "已核对名称与负责人列",
            remaining: calls === 1 ? "未核对" : "",
            blocker: "",
            nextAction: calls === 1 ? "核对列表字段" : "",
            requiresWrite: false,
            evidenceIds: [id],
            sourceIds: [],
          },
        ],
        action: { kind: "finish", reason: "已观察" },
      });
    },
  );
  const settle = async () => {
    for (
      let i = 0;
      i < 300 && service.state(p.id).run?.state === "running";
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
  };
  try {
    const initial = await service.start(p.id, "理解", 6);
    await settle();
    const before = service.state(p.id);
    assert.equal(before.run!.state, "draft");
    assert.equal(calls, 2);
    assert(before.run!.steps[0].result.includes("仍有 1 项可执行功能"));
    assert.equal(before.run!.features![0].state, "verified");
    const oldRun = JSON.stringify(before.run),
      oldReport = JSON.stringify(before.reports[0]);
    await service.continueExploration(p.id, initial.id, 4);
    await settle();
    assert.equal(service.state(p.id).run!.features!.length, 1);
    assert.equal(JSON.stringify(service.memory.run(p.id, initial.id)), oldRun);
    assert.equal(
      JSON.stringify(service.memory.get(p.id, before.reports[0].id)),
      oldReport,
    );
  } finally {
    await service.close();
    db.close();
  }
});

test("overview blocks form actions and finishes without deep coverage; screenshot creates a new review", async () => {
  const { db, projects, p } = fixture();
  let actions = 0,
    calls = 0;
  let service: DiscoveryService;
  service = new DiscoveryService(
    projects,
    {
      open: async () => {},
      begin: async () => page.url,
      observe: async () => ({
        ...page,
        html: "<!doctype html><html><body>客户</body></html>",
        captureNotes: ["画布请补图"],
        png: new Uint8Array([1]),
      }),
      action: async () => {
        actions++;
      },
      manual: async () => {},
      close: () => {},
    },
    async (_id, prompt) => {
      if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE"))
        return moduleReply(prompt);
      if (prompt.startsWith("PRODUCK_DISCOVERY_REPORT"))
        return JSON.stringify(output(service.state(p.id).run!));
      assert(prompt.includes("不是功能验收"));
      calls++;
      return JSON.stringify({
        module: "客户",
        modulePurpose: "管理客户关系",
        observation: "已看到列表",
        captureNotes: [],
        action:
          calls === 1
            ? { kind: "fill", index: 2, value: "test", effect: "read" }
            : { kind: "finish", reason: "已了解用途，画布需截图" },
      });
    },
  );
  const settle = async () => {
    for (
      let i = 0;
      i < 300 && service.state(p.id).run?.state === "running";
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
  };
  try {
    await service.start(p.id, "了解系统", 16, "overview");
    await settle();
    const state = service.state(p.id);
    assert.equal(state.run!.state, "draft");
    assert.equal(actions, 0);
    assert.equal(calls, 2);
    assert.equal(state.run!.finishCorrections, 0);
    assert(state.run!.steps[0].result.includes("轻量采集不执行"));
    assert.equal(state.run!.modules![0].purpose, "管理客户关系");
    const report = state.reports[0];
    service.memory.approve(p.id, report.id, report.digest);
    const original = JSON.stringify(service.memory.run(p.id, state.run!.id));
    const supplement = service.supplement(
      p.id,
      state.run!.id,
      "客户",
      "画布布局",
      new Uint8Array([1, 2]),
    );
    assert.equal(supplement.state, "draft");
    assert.notEqual(supplement.reportId, report.id);
    assert.equal(service.memory.active(p.id)!.id, report.id);
    assert.equal(
      service.memory.get(p.id, supplement.reportId!).approvedAt,
      undefined,
    );
    assert.equal(
      JSON.stringify(service.memory.run(p.id, state.run!.id)),
      original,
    );
    assert.throws(() =>
      service.supplement(
        p.id,
        supplement.id,
        "不存在",
        "说明",
        new Uint8Array([1]),
      ),
    );
  } finally {
    await service.close();
    db.close();
  }
});

test("overview auto candidate waits for summary; supplements keep identity, baseline and memory approval separate", async () => {
  const { db, projects, p, other } = fixture();
  let service: DiscoveryService;
  const generated: string[] = [];
  service = new DiscoveryService(
    projects,
    {
      open: async () => {},
      begin: async () => page.url,
      observe: async () => ({ ...page, png: new Uint8Array([1]) }),
      action: async () => {},
      manual: async () => {},
      close: () => {},
    },
    async (_id, prompt) => {
      if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE"))
        return moduleReply(prompt);
      if (prompt.startsWith("PRODUCK_DISCOVERY_REPORT"))
        return JSON.stringify(output(service.state(p.id).run!));
      return JSON.stringify({
        module: "客户",
        modulePurpose: "客户资料管理",
        observation: "列表布局",
        captureNotes: ["缺画布截图", "缺详情截图"],
        action: { kind: "finish", reason: "足够还原主页面" },
      });
    },
    async (scope, run) => {
      assert(run.reportId);
      assert(run.modules!.every((m) => m.markdown));
      assert.equal(service.memory.active(scope), null);
      assert.equal(
        service.memory.get(scope, run.reportId!).approvedAt,
        undefined,
      );
      if (generated.length) assert.equal(run.prototypeVersionId, generated[0]);
      const id = `candidate-${generated.length}`;
      generated.push(id);
      return id;
    },
  );
  const settle = async () => {
    for (let i = 0; i < 400; i++) {
      const r = service.state(p.id).run;
      if (r?.state !== "running" && r?.phase !== "generating") return;
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  try {
    const initial = await service.start(p.id, "理解", 16, "overview");
    await settle();
    const before = service.memory.run(p.id, initial.id);
    assert.equal(before.phase, "ready");
    assert.equal(before.prototypeVersionId, "candidate-0");
    assert.equal(before.roundSteps, 1);
    const frozen = JSON.stringify(before);
    const plan = before.supplementPlan!;
    assert.equal(plan.length, 2);
    const foreign = saveCapture(
      other.workspace,
      {
        title: "foreign",
        url: page.url,
        text: "",
        structure: "[]",
        capturedAt: new Date().toISOString(),
        actions: [],
      },
      new Uint8Array([1]),
    );
    assert.throws(() =>
      service.addSupplements(p.id, initial.id, [
        { needId: plan[0].id, description: "", captureId: foreign.id },
      ]),
    );
    assert.throws(() =>
      service.addSupplements(p.id, initial.id, [
        { needId: plan[0].id, description: "", png: new Uint8Array([2]) },
        { needId: plan[0].id, description: "", png: new Uint8Array([3]) },
      ]),
    );
    const next = service.addSupplements(p.id, initial.id, [
      { needId: plan[1].id, description: "详情布局", png: new Uint8Array([2]) },
      { needId: plan[0].id, description: "画布布局", png: new Uint8Array([3]) },
    ]);
    assert.deepEqual(
      next.supplements!.map((s) => s.description),
      ["详情布局", "画布布局"],
    );
    assert.equal(next.roundSteps, 1);
    assert.equal(next.prototypeVersionId, "candidate-0");
    const result = await service.generateCandidate(p.id, next.id);
    assert.equal(result.prototypeVersionId, "candidate-1");
    assert.equal(JSON.stringify(service.memory.run(p.id, initial.id)), frozen);
    assert.throws(() =>
      service.addSupplements(p.id, next.id, [
        { needId: plan[0].id, description: "重复", png: new Uint8Array([2]) },
      ]),
    );
  } finally {
    await service.close();
    db.close();
  }
});

test("incremental overview paints each observation before the next browser action and before report", async () => {
  const { db, projects, p } = fixture();
  let service: DiscoveryService;
  const order: string[] = [];
  let decisions = 0;
  service = new DiscoveryService(
    projects,
    {
      open: async () => {},
      begin: async () => page.url,
      observe: async () => {
        order.push("observe");
        return { ...page, png: new Uint8Array([1]) };
      },
      action: async () => {
        order.push("action");
      },
      manual: async () => {},
      close: () => {},
    },
    async (_id, prompt) => {
      if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE"))
        return moduleReply(prompt);
      if (prompt.startsWith("PRODUCK_DISCOVERY_REPORT")) {
        order.push("report");
        return JSON.stringify(output(service.state(p.id).run!));
      }
      decisions++;
      return JSON.stringify({
        module: "客户",
        observation: "客户列表",
        action:
          decisions === 1
            ? { kind: "click", index: 0, effect: "read" }
            : { kind: "finish", reason: "主要页面已了解" },
      });
    },
    async () => {
      order.push("finalize");
      return "page-version";
    },
    async (_scope, run, captureId) => {
      assert.equal(run.reportId, undefined);
      assert(run.captureIds.includes(captureId));
      order.push("paint");
    },
  );
  try {
    await service.start(p.id, "了解用途", 16, "overview");
    for (let i = 0; i < 400; i++) {
      const r = service.state(p.id).run!;
      if (r.state !== "running" && r.phase !== "generating") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.deepEqual(order.slice(0, 5), [
      "observe",
      "paint",
      "action",
      "observe",
      "paint",
    ]);
    assert(order.indexOf("report") > order.lastIndexOf("paint"));
    assert.equal(order.at(-1), "finalize");
  } finally {
    service.close();
    db.close();
  }
});
