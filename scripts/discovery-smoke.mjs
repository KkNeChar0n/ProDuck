import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChromeDiscoveryBrowser } from "../dist/discovery/chrome.js";
import { DiscoveryService } from "../dist/discovery/service.js";
import { openProjectDatabase } from "../dist/projects/storage.js";
import { ProjectRepository } from "../dist/projects/repository.js";
import { importSource } from "../dist/projects/sources.js";
import { PrototypeRepository } from "../dist/prototypes/repository.js";
import { PrototypeGenerator } from "../dist/agent/prototype-generator.js";
const root = mkdtempSync(join(tmpdir(), "produck-chrome-test-"));
let writes = 0,
  queries = 0,
  confirmations = 0,
  allowBusiness = false,
  generatorPrompt = "";
const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/login") {
    res.setHeader(
      "Set-Cookie",
      "fixture=logged-in; SameSite=Lax; Max-Age=86400",
    );
    res.end("ok");
    return;
  }
  if (req.url === "/query") {
    queries++;
    res.end("查询完成");
    return;
  }
  if (req.url === "/write") {
    writes++;
    res.end("written");
    return;
  }
  if (req.url.startsWith("/model")) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      generatorPrompt = JSON.parse(body).messages[0].content;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const html =
        '<!doctype html><html><body><nav><button onclick="document.querySelector(\'#customers\').hidden=false">客户模块</button><button onclick="document.querySelector(\'#orders\').hidden=false">订单模块</button></nav><section id="customers"><h1>客户管理</h1></section><section id="orders"><h1>订单管理</h1></section></body></html>';
      res.end(
        "data: " +
          JSON.stringify({ choices: [{ delta: { content: html } }] }) +
          "\n\ndata: [DONE]\n\n",
      );
    });
    return;
  }
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(
    `<!doctype html><html><head><title>${req.url === "/orders" ? "订单模块" : "客户模块"}</title></head><body><button onclick="document.querySelector('nav').hidden=!document.querySelector('nav').hidden">切换侧边栏</button><nav hidden><a href="/">客户模块</a><a href="/orders">订单模块</a></nav><h1>${req.url === "/orders" ? "订单管理" : "客户管理"}</h1><input type="search" placeholder="搜索客户"><input aria-label="备注"><button onclick="fetch('/query',{method:'POST'}).then(r=>r.text()).then(t=>document.querySelector('#query-result').textContent=t)">应用</button><p id="query-result"></p><button onclick="document.querySelector('#detail').hidden=false">查看详情</button><div id="detail" hidden>客户拥有多个订单</div><button onclick="fetch('/write',{method:'POST'})">保存客户</button><p>登录状态：${req.headers.cookie?.includes("fixture=logged-in") ? "已登录" : "未登录"}</p></body></html>`,
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
const db = openProjectDatabase(join(root, "db"));
const projects = new ProjectRepository(db, join(root, "state"));
const a = projects.create("产品理解测试", root),
  b = projects.create("隔离项目", root);
const release = projects.createRelease(a.id, "V1.0.0");
const browser = new ChromeDiscoveryBrowser(join(root, "chrome"), async () => {
  confirmations++;
  return allowBusiness;
});
let service;
try {
  await browser.open(a.id, url);
  await new Promise((r) => setTimeout(r, 700));
  // Simulate the user logging into a local fixture; never touches a real service.
  const session = browser.sessions.get(a.id);
  await session.pipe.send(
    "Runtime.evaluate",
    {
      expression: "fetch('/login',{method:'POST'}).then(()=>location.reload())",
      awaitPromise: true,
    },
    session.session,
  );
  await new Promise((r) => setTimeout(r, 700));
  assert((await browser.observe(a.id)).text.includes("已登录"));
  await browser.open(b.id, url);
  await new Promise((r) => setTimeout(r, 700));
  assert((await browser.observe(b.id)).text.includes("未登录"));
  writeFileSync(
    join(root, "handoff.md"),
    "交接说明：客户拥有多个订单，订单状态包括草稿、已支付、已关闭。",
  );
  importSource(a.workspace, join(root, "handoff.md"));
  let call = 0;
  service = new DiscoveryService(projects, browser, async (scope, prompt) => {
    assert.equal(scope, release.id);
    assert(prompt.includes("客户拥有多个订单"));
    if (prompt.startsWith("PRODUCK_DISCOVERY_MODULE")) {
      const payload = JSON.parse(prompt.split("模块资料：")[1]);
      return JSON.stringify({
        understanding: "当前模块的页面与交接资料理解",
        flows: [],
        unknowns: ["未完整覆盖"],
        evidenceIds: [payload.evidence[0].id],
      });
    }
    if (prompt.startsWith("PRODUCK_DISCOVERY_STEP")) {
      call++;
      const evidence = JSON.parse(prompt.split("页面证据：")[1]);
      const labels = ["切换侧边栏", "查看详情", "订单模块"];
      const action =
        call <= 3
          ? {
              kind: "click",
              index: evidence.elements.find((e) => e.label === labels[call - 1])
                .index,
              effect: "read",
            }
          : { kind: "finish", reason: "两个模块已观察，提交流程未体验" };
      return JSON.stringify({
        observation:
          call < 4
            ? "客户模块：查看详情展示客户与订单关系"
            : "订单模块：有订单列表入口",
        action,
      });
    }
    const run = service.state(scope).run;
    return JSON.stringify({
      overview: "客户与订单管理产品",
      modules: [
        {
          name: "客户",
          understanding: "管理客户及其订单关系",
          flows: ["客户列表→查看详情→展示客户订单关系"],
          evidenceIds: [
            run.captureIds[0],
            run.captureIds[1],
            run.sources[0].id,
          ],
          unknowns: ["新增提交未体验"],
        },
        {
          name: "订单",
          understanding: "订单列表；状态规则来自交接资料",
          flows: ["导航订单模块→订单页面"],
          evidenceIds: [run.captureIds[3]],
          unknowns: ["支付流程未体验"],
        },
      ],
      conflicts: [],
      limitations: ["仅本地测试站点，未执行保存"],
    });
  });
  await service.start(release.id, "理解客户与订单模块", 6);
  let result;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));
    result = service.state(release.id);
    if (result.run.state !== "running") break;
  }
  assert.equal(result.run.state, "draft", result.run.message);
  assert.equal(result.run.captureIds.length, 6);
  assert.equal(result.activeReportId, null);
  const report = result.reports[0];
  assert(report.markdown.includes("客户"));
  assert(report.markdown.includes("订单"));
  const revisions = new PrototypeRepository(db, projects);
  const models = {
    request: async (_id, prompt, signal) => ({
      provider: "openai-compatible",
      endpoint: url + "/model",
      model: "fixture",
      token: "fixture-only",
      prompt,
      signal,
    }),
  };
  const generator = new PrototypeGenerator(db, projects, models, revisions);
  await assert.rejects(
    generator.generate(
      release.id,
      report.captureIds[0],
      () => {},
      "",
      undefined,
      { understanding: { id: report.id, digest: report.digest } },
    ),
    /审核/,
  );
  service.memory.approve(release.id, report.id, report.digest);
  const candidate = await generator.generate(
    release.id,
    report.captureIds[0],
    () => {},
    "生成模块原型",
    undefined,
    { understanding: { id: report.id, digest: report.digest } },
  );
  assert.equal(candidate.sourceRefs.length, 6);
  assert.equal(candidate.approved, false);
  assert(generatorPrompt.includes("已审核产品理解"));
  assert(generatorPrompt.includes("客户与订单管理产品"));
  assert(generatorPrompt.includes("订单模块"));
  assert.equal(
    revisions.details(release.id, candidate.id).understanding.digest,
    report.digest,
  );
  await browser.begin(a.id);
  let observed = await browser.observe(a.id);
  const apply = observed.elements.find((e) => e.label === "应用");
  await browser.action(
    a.id,
    observed,
    { kind: "click", index: apply.index, effect: "read" },
    new AbortController().signal,
  );
  assert.equal(queries, 1);
  assert.equal(confirmations, 0);
  observed = await browser.observe(a.id);
  assert(observed.text.includes("查询完成"));
  const note = observed.elements.find((e) => e.label === "备注");
  await browser.action(
    a.id,
    observed,
    { kind: "fill", index: note.index, value: "模拟输入", effect: "read" },
    new AbortController().signal,
  );
  observed = await browser.observe(a.id);
  await browser.action(
    a.id,
    observed,
    { kind: "press", index: note.index, key: "Tab", effect: "read" },
    new AbortController().signal,
  );
  observed = await browser.observe(a.id);
  const save = observed.elements.find((e) => e.label === "保存客户");
  await assert.rejects(
    browser.action(
      a.id,
      observed,
      { kind: "click", index: save.index, effect: "write" },
      new AbortController().signal,
    ),
    /跳过/,
  );
  assert.equal(confirmations, 1);
  assert.equal(writes, 0);
  await assert.rejects(
    browser.action(
      a.id,
      observed,
      { kind: "click", index: save.index, effect: "write" },
      new AbortController().signal,
    ),
    /跳过/,
  );
  assert.equal(confirmations, 1);
  await browser.manual(a.id);
  await browser.begin(a.id);
  allowBusiness = true;
  observed = await browser.observe(a.id);
  await browser.action(
    a.id,
    observed,
    { kind: "click", index: save.index, effect: "write" },
    new AbortController().signal,
  );
  assert.equal(writes, 1);
  assert.equal(confirmations, 2);
  observed = await browser.observe(a.id);
  await assert.rejects(
    browser.action(
      a.id,
      observed,
      { kind: "click", index: save.index, effect: "write" },
      new AbortController().signal,
    ),
    /不自动重复/,
  );
  await session.pipe.send(
    "Runtime.evaluate",
    {
      expression: "fetch('/write',{method:'POST'}).catch(()=>{})",
      awaitPromise: true,
    },
    session.session,
  );
  assert.equal(writes, 1);
  assert(
    (await browser.observe(a.id)).blocked.some((x) => x.startsWith("POST")),
  );
  await browser.manual(a.id);
  generator.close();
  await browser.close();
  await new Promise((r) => setTimeout(r, 1000));
  await browser.open(a.id, url);
  await new Promise((r) => setTimeout(r, 700));
  assert((await browser.observe(a.id)).text.includes("已登录"));
  mkdirSync("docs/verification", { recursive: true });
  writeFileSync(
    "docs/verification/product-discovery-smoke.json",
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        chrome: true,
        modules: 2,
        captures: 6,
        profileIsolation: true,
        loginRetained: true,
        unapprovedWritesBlocked: true,
        confirmedWriteOnce: true,
        sidebarAutomatic: true,
        postQuery: true,
        genericInput: true,
        keyboard: true,
        approvedUnderstanding: true,
        candidateSources: 6,
        model: "synthetic fixture; not a real model quality assessment",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS: real Chrome isolated profiles, retained login, two-module exploration, handoff synthesis, exact approval, blocked write and multi-source prototype",
  );
} finally {
  if (service) await service.close();
  else await browser.close();
  db.close();
  server.close();
}
