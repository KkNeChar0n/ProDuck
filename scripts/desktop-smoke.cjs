const { app, BrowserWindow, dialog, webContents } = require("electron");
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
let server,
  credentialRef,
  platformCredentialRef,
  yunxiaoCredentialRef,
  plannerCalls = 0,
  builtinCalls = 0,
  builtinArgs;
async function cleanup() {
  if (credentialRef) {
    const { MacKeychain } = await import("../dist/integrations/credentials.js");
    await new MacKeychain(resolve("dist/native/produck-keychain")).delete(
      credentialRef,
      platformCredentialRef,
    );
    credentialRef = null;
  }
  if (platformCredentialRef) {
    const { MacKeychain } = await import("../dist/integrations/credentials.js");
    await new MacKeychain(resolve("dist/native/produck-keychain")).delete(
      platformCredentialRef,
    );
    platformCredentialRef = null;
  }
  if (yunxiaoCredentialRef) {
    const { MacKeychain } = await import("../dist/integrations/credentials.js");
    await new MacKeychain(resolve("dist/native/produck-keychain")).delete(
      yunxiaoCredentialRef,
    );
  }
  if (server) server.close();
}
const root = mkdtempSync(join(tmpdir(), "produck-desktop-test-"));
app.setPath("userData", join(root, "profile"));
if (process.argv.includes("--without-cli")) {
  const emptyPath = join(root, "no-cli");
  mkdirSync(emptyPath);
  process.env.PATH = emptyPath;
  const { spawnSync } = require("node:child_process");
  for (const command of ["node", "python", "python3", "codex", "claude"]) {
    assert.equal(spawnSync(command, ["--version"]).error?.code, "ENOENT");
  }
  console.log("CLI isolation: Node/Python/Codex/Claude unavailable on PATH");
}

mkdirSync(join(root, "skill"));
writeFileSync(
  join(root, "skill/SKILL.md"),
  "---\nname: product-review-fixture\ndescription: Review project evidence\nallowed-tools: Read, Write\n---\nSKILL_FIXTURE_MARKER: 读取项目资料，整理待确认问题。\n",
);
writeFileSync(join(root, "handoff.md"), "# 桌面测试交接\n客户筛选规则。");
dialog.showOpenDialog = async (_window, options) => ({
  canceled: false,
  filePaths: [
    options.title === "导入交接资料"
      ? join(root, "handoff.md")
      : options.title === "导入 Skill 文件夹"
        ? join(root, "skill")
        : root,
  ],
});
const ready = new Promise((resolve) =>
  app.once("browser-window-created", (_event, window) =>
    window.webContents.once("did-finish-load", () => resolve(window)),
  ),
);
const wait = async (w, expression) => {
  for (let i = 0; i < 200; i++) {
    if (await w.webContents.executeJavaScript(expression)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("UI condition timed out: " + expression);
};
(async () => {
  const originalFetch = globalThis.fetch;
  const feishuFixture = require("./feishu-fixture.cjs")();
  let yunxiaoWrites = 0;
  let itemStatus = { id: "todo", name: "待开始" };
  globalThis.fetch = (url, init) =>
    String(url).startsWith("https://openapi-rdc.aliyuncs.com/")
      ? (async () => {
          if (init?.method === "PUT") {
            assert.deepEqual(JSON.parse(init.body), { status: "design" });
            yunxiaoWrites++;
            itemStatus = { id: "design", name: "设计中" };
            return new Response(null, { status: 204 });
          }
          if (String(url).endsWith("/workflows"))
            return Response.json({
              statuses: [{ id: "design", name: "设计中" }],
            });
          return Response.json({
            id: "item",
            subject: "模拟云效需求",
            logicalStatus: "normal",
            space: { id: "proj" },
            workitemType: { id: "requirement" },
            status: itemStatus,
            updateStatusAt: "1",
          });
        })()
      : String(url).startsWith("https://open.feishu.cn/")
        ? feishuFixture.fetch(url, init)
        : originalFetch(url, init);
  dialog.showMessageBox = async (_window, options) => {
    assert(
      options.buttons.includes("确认发布到飞书") ||
        options.buttons.includes("确认同步云效"),
    );
    return { response: 1, checkboxChecked: false };
  };
  await import(pathToFileURL(resolve("dist/desktop/main.js")).href);
  const window = await ready;
  const wc = window.webContents;
  const errors = [];
  wc.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  await wait(window, `document.body.innerText.includes('创建第一个项目')`);
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='创建第一个项目').click()`,
  );
  await wait(window, `document.querySelector('dialog')?.open`);
  await wc.executeJavaScript(
    `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(document.querySelector('#project-name'),'桌面验证项目');document.querySelector('#project-name').dispatchEvent(new Event('input',{bubbles:true}));`,
  );
  await wait(
    window,
    `!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='选择文件夹并创建').disabled`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='选择文件夹并创建').click()`,
  );
  await wait(
    window,
    `!document.querySelector('dialog') && document.body.innerText.includes('桌面验证项目')`,
  );
  let state = await wc.executeJavaScript("window.produck.projects.state()");
  assert.equal(state.projects.length, 1);
  const first = state.projects[0];
  await wc.executeJavaScript(
    `window.produck.projects.saveConnection(${JSON.stringify(first.id)},{provider:'feishu',url:'https://example.feishu.cn/wiki/fixture'})`,
  );
  state = await wc.executeJavaScript(
    `window.produck.projects.create('第二个项目')`,
  );
  const second = state.projects.find((p) => p.id !== first.id);
  assert(second);
  assert.notEqual(first.workspace, second.workspace);
  assert.equal(
    (
      await wc.executeJavaScript(
        `window.produck.projects.connections(${JSON.stringify(second.id)})`,
      )
    ).length,
    0,
  );
  await wc.executeJavaScript(
    `window.produck.projects.select(${JSON.stringify(first.id)})`,
  );
  const reloaded = new Promise((r) => wc.once("did-finish-load", r));
  wc.reload();
  await reloaded;
  await wait(
    window,
    `document.querySelector('#project-select')?.value===${JSON.stringify(first.id)}`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('.nav')).find(b=>b.textContent.includes('项目记忆')).click()`,
  );
  await wait(
    window,
    `document.querySelector('.memory-content')?.textContent.includes('桌面验证项目')`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('.nav')).find(b=>b.textContent.includes('工作台')).click()`,
  );
  await wait(window, `document.querySelector('[role=tablist]')!==null`);
  await wc.executeJavaScript(
    `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  mkdirSync("docs/verification", { recursive: true });
  writeFileSync(
    "docs/verification/desktop-projects.png",
    (await wc.capturePage()).toPNG(),
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('[role=tab]')).find(b=>b.textContent==='交接资料').click()`,
  );
  await wait(
    window,
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='导入交接资料')`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='导入交接资料').click()`,
  );
  await wait(window, `document.body.innerText.includes('handoff.md')`);
  assert.equal(
    (
      await wc.executeJavaScript(
        `window.produck.projects.sources(${JSON.stringify(first.id)})`,
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await wc.executeJavaScript(
        `window.produck.projects.sources(${JSON.stringify(second.id)})`,
      )
    ).length,
    0,
  );
  server = createServer((req, res) => {
    if (req.method === "GET") {
      res.setHeader("Content-Type", "text/html;charset=utf-8");
      res.end(require("node:fs").readFileSync("tests/fixtures/customers.html"));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.headers.authorization !== "Bearer synthetic-desktop-token") {
        res.writeHead(401);
        res.end("{}");
        return;
      }
      const data = JSON.parse(body);
      if (data.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        let content = data.messages[0].content.includes("原型工程师")
          ? require("node:fs").readFileSync(
              "tests/fixtures/customers.html",
              "utf8",
            )
          : data.messages[0].content.includes("Markdown PRD")
            ? "# 客户管理 PRD\n\n## 目标\n支持筛选和新增客户。\n\n## 待确认\n权限规则待确认。"
            : "模型流式响应已验证";
        if (
          data.messages[0].content.includes("只返回一个 JSON") &&
          data.messages[0].content.includes("BUILTIN_PRD_TEST")
        ) {
          assert(data.messages[0].content.includes("不得声称已经发布"));
          builtinCalls++;
          content = JSON.stringify(
            builtinCalls === 1
              ? { call: { tool: "product_artifacts", args: {} } }
              : builtinCalls === 2
                ? { call: { tool: "generate_prd", args: builtinArgs } }
                : { done: "内置技能已保存草稿，等待人工审阅。" },
          );
        } else if (data.messages[0].content.includes("只返回一个 JSON")) {
          assert(data.messages[0].content.includes("SKILL_FIXTURE_MARKER"));
          plannerCalls++;
          content = JSON.stringify(
            plannerCalls === 1
              ? { call: { tool: "project_sources", args: {} } }
              : plannerCalls === 2
                ? {
                    call: {
                      tool: "write_note",
                      args: { content: "# 待确认问题\n权限规则待核对。" },
                    },
                  }
                : { done: "项目资料已整理，笔记已保存。" },
          );
        }
        res.end(
          "data: " +
            JSON.stringify({ choices: [{ delta: { content } }] }) +
            "\n\ndata: [DONE]\n\n",
        );
      } else {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const profile = await wc.executeJavaScript(
    `window.produck.models.save(${JSON.stringify(first.id)},{provider:'openai-compatible',endpoint:'http://127.0.0.1:${server.address().port}/v1',model:'fixture',token:'synthetic-desktop-token'})`,
  );
  assert.equal(profile.hasCredential, true);
  assert(!JSON.stringify(profile).includes("synthetic-desktop-token"));
  const { DatabaseSync } = require("node:sqlite");
  const checkDb = new DatabaseSync(join(root, "profile", "projects.sqlite"));
  credentialRef = checkDb
    .prepare("SELECT credential_ref FROM model_profiles WHERE id=?")
    .get(first.id).credential_ref;
  checkDb.close();
  await wc.executeJavaScript(
    `window.produck.models.test(${JSON.stringify(first.id)})`,
  );
  await wc.executeJavaScript(
    `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(document.querySelector('textarea'),'测试流式对话');document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}));`,
  );
  await wait(
    window,
    `!document.querySelector('[aria-label="发送修改要求"]').disabled`,
  );
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="发送修改要求"]').click()`,
  );
  await wait(window, `document.body.innerText.includes('模型流式响应已验证')`);
  await wait(
    window,
    `document.querySelector('[aria-label="发送修改要求"]')!==null`,
  );
  writeFileSync(
    "docs/verification/desktop-model.png",
    (await wc.capturePage()).toPNG(),
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('[role=tab]')).find(b=>b.textContent==='浏览器').click()`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="页面地址"]')!==null`,
  );
  await wc.executeJavaScript(
    `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(document.querySelector('[aria-label="页面地址"]'),'http://127.0.0.1:${server.address().port}/customers');document.querySelector('[aria-label="页面地址"]').dispatchEvent(new Event('input',{bubbles:true}));`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='打开网页').click()`,
  );
  await wait(
    window,
    `!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='采集当前状态').disabled`,
  );
  await new Promise((r) => setTimeout(r, 200));
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='采集当前状态').click()`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="页面依据"]').options.length===2`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='依据此状态生成原型').click()`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="原型版本"]')?.options.length===1 && !Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='通过此版本').disabled`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='通过此版本').click()`,
  );
  await wait(
    window,
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='此版本已通过')`,
  );
  await wc.executeJavaScript(
    `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(document.querySelector('textarea'),'调整客户列表标题');document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}));`,
  );
  await wait(
    window,
    `!document.querySelector('[aria-label="发送修改要求"]').disabled`,
  );
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="发送修改要求"]').click()`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="原型版本"]')?.options.length===2`,
  );
  const versionList = await wc.executeJavaScript(
    `window.produck.workbench.versions(${JSON.stringify(first.id)})`,
  );
  assert.equal(versionList[0].approved, false);
  assert.equal(versionList[1].approved, true);
  assert.equal(
    (
      await wc.executeJavaScript(
        `window.produck.projects.pageMemory(${JSON.stringify(first.id)},'客户')`,
      )
    ).length,
    1,
  );
  await new Promise((r) => setTimeout(r, 200));
  writeFileSync(
    "docs/verification/desktop-workbench.png",
    (await wc.capturePage()).toPNG(),
  );
  const prototypeContents = webContents
    .getAllWebContents()
    .find((w) => w.getURL().startsWith("data:"));
  assert(prototypeContents);
  assert.equal(
    await prototypeContents.executeJavaScript(
      "document.querySelector('h1').textContent",
    ),
    "客户列表",
  );
  const prototypeView = window.contentView.children.find(
    (v) => v.webContents === prototypeContents,
  );
  assert(prototypeView && prototypeView.getBounds().width > 100);
  writeFileSync(
    "docs/verification/desktop-prototype.png",
    (await prototypeContents.capturePage()).toPNG(),
  );
  await assert.rejects(
    wc.executeJavaScript(
      `window.produck.documents.generate(${JSON.stringify(first.id)},${JSON.stringify(versionList[0].id)},['x'],'')`,
    ),
    /先通过/,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='通过此版本').click()`,
  );
  await wait(window, `!!document.querySelector('[aria-label="页面状态名称"]')`);
  await wc.executeJavaScript(
    `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(document.querySelector('[aria-label="页面状态名称"]'),'客户列表默认状态');document.querySelector('[aria-label="页面状态名称"]').dispatchEvent(new Event('input',{bubbles:true}));`,
  );
  await wait(
    window,
    `!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='保存文档截图').disabled`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='保存文档截图').click()`,
  );
  await wait(window, `document.body.innerText.includes('可在文档中选择')`);
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('文档')).click()`,
  );
  await wait(window, `!!document.querySelector('.state-choice input')`);
  await wc.executeJavaScript(
    `document.querySelector('.state-choice input').click()`,
  );
  await wait(
    window,
    `!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='生成 PRD 草稿').disabled`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='生成 PRD 草稿').click()`,
  );
  await wait(
    window,
    `document.querySelector('.document-text')?.textContent.includes('客户管理 PRD') && document.querySelector('.document-image')?.complete`,
  );
  dialog.showSaveDialog = async () => ({
    canceled: false,
    filePath: join(root, "exported-prd.html"),
  });
  const drafts = await wc.executeJavaScript(
    `window.produck.documents.list(${JSON.stringify(first.id)})`,
  );
  assert.equal(drafts[0].versionId, versionList[0].id);
  await wc.executeJavaScript(
    `window.produck.documents.export(${JSON.stringify(first.id)},${JSON.stringify(drafts[0].id)})`,
  );
  assert.match(
    readFileSync(join(root, "exported-prd.html"), "utf8"),
    /data:image\/png;base64,/,
  );
  await wc.executeJavaScript(
    "document.querySelector('.document-text').scrollIntoView({block:'start'}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  writeFileSync(
    "docs/verification/desktop-documents.png",
    (await wc.capturePage()).toPNG(),
  );
  const tasks = await wc.executeJavaScript(
    `window.produck.workbench.tasks(${JSON.stringify(first.id)})`,
  );
  assert.equal(tasks.length, 2);
  assert(tasks.every((t) => t.state === "succeeded" && !t.recoverable));
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('工作流')).click()`,
  );
  await wait(
    window,
    `document.body.innerText.includes('原型生成记录') && document.body.innerText.includes('已保存候选')`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('Skills')).click()`,
  );
  await wait(
    window,
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='导入 Skill 文件夹')`,
  );
  for (const [action, expected] of [
    ["开始制作原型", "页面体验与原型"],
    ["进入 PRD 工作流", "文档"],
    ["进入文档差异评审", "文档"],
  ]) {
    assert(
      await wc.executeJavaScript(
        `document.body.innerText.includes('原文合并与共用附件更新暂缓')`,
      ),
    );
    await wc.executeJavaScript(
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(action)}).click()`,
    );
    await wait(window, `!document.body.innerText.includes('内置工作流')`);
    if (expected === "文档")
      await wait(window, `document.body.innerText.includes('发布材料审阅')`);
    else
      await wait(
        window,
        `document.querySelector('[aria-label="页面地址"]') !== null`,
      );
    await wc.executeJavaScript(
      `Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('Skills')).click()`,
    );
    await wait(window, `document.body.innerText.includes('内置工作流')`);
  }
  writeFileSync(
    "docs/verification/desktop-builtin-skills.png",
    (await wc.capturePage()).toPNG(),
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='导入 Skill 文件夹').click()`,
  );
  await wait(
    window,
    `document.body.innerText.includes('product-review-fixture')`,
  );
  const importedSkills = await wc.executeJavaScript(
    `window.produck.skills.list(${JSON.stringify(first.id)})`,
  );
  assert.equal(importedSkills[0].status, "needs-approval");
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='前往工作流选择技能').click()`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="Agent 技能"]')?.options.length===4`,
  );
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="Agent 技能"]').value=${JSON.stringify(importedSkills[0].id)};document.querySelector('[aria-label="Agent 技能"]').dispatchEvent(new Event('change',{bubbles:true}));`,
  );
  await wc.executeJavaScript(
    `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(document.querySelector('[aria-label="Agent 任务要求"]'),'整理项目资料并保存待确认问题');document.querySelector('[aria-label="Agent 任务要求"]').dispatchEvent(new Event('input',{bubbles:true}));`,
  );
  await wait(
    window,
    `!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='执行任务').disabled`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='执行任务').click()`,
  );
  await wait(
    window,
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='批准这一步')`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='批准这一步').click()`,
  );
  await wait(
    window,
    `document.body.innerText.includes('项目资料已整理，笔记已保存。')`,
  );
  const agentRuns = await wc.executeJavaScript(
    `window.produck.agent.list(${JSON.stringify(first.id)})`,
  );
  assert.equal(agentRuns[0].state, "succeeded");
  assert.equal(agentRuns[0].steps.length, 2);
  assert.equal(plannerCalls, 3);
  assert.equal(agentRuns[0].skill.fingerprint, importedSkills[0].fingerprint);
  assert(
    require("node:fs")
      .readdirSync(join(first.workspace, "workflows"))
      .some((x) => x.endsWith("-note.md")),
  );
  await wc.executeJavaScript(
    "document.querySelector('[aria-label=\"Agent 任务要求\"]').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
  );
  writeFileSync(
    "docs/verification/desktop-agent.png",
    (await wc.capturePage()).toPNG(),
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='项目设置').click()`,
  );
  await wait(window, `document.querySelector('input[name=appId]') !== null`);
  await wc.executeJavaScript(
    `document.querySelector('input[name=appId]').value='cli_fixture';document.querySelector('input[name=appId]').form.querySelector('input[name=secret]').value='synthetic-platform-secret';document.querySelector('input[name=appId]').form.requestSubmit()`,
  );
  await wait(
    window,
    `document.body.innerText.includes('配置已保存，凭证已存入钥匙串')`,
  );
  const platformDb = new DatabaseSync(join(root, "profile", "projects.sqlite"));
  platformCredentialRef = platformDb
    .prepare(
      "SELECT credential_ref FROM connections WHERE project_id=? AND provider='feishu'",
    )
    .get(first.id).credential_ref;
  platformDb.close();
  assert.equal(
    await wc.executeJavaScript(
      `document.querySelector('input[name=appId]').form.querySelector('input[name=secret]').value`,
    ),
    "",
  );
  assert.equal(
    await wc.executeJavaScript(
      `window.produck.platforms.profile(${JSON.stringify(second.id)}, 'feishu')`,
    ),
    null,
  );
  await wc.executeJavaScript(
    `document.querySelector('input[name=appId]').form.querySelector('button[type=button]').click()`,
  );
  await wait(
    window,
    `document.body.innerText.includes('读取成功：平台连接测试迭代')`,
  );
  await wc.executeJavaScript(
    `document.querySelector('input[name=appId]').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  writeFileSync(
    "docs/verification/desktop-platforms.png",
    (await wc.capturePage()).toPNG(),
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('文档')).click()`,
  );
  await wait(
    window,
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='准备发布审阅包')`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='准备发布审阅包').click()`,
  );
  await wait(
    window,
    `document.body.innerText.includes('目标父节点：平台连接测试迭代')`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='确认材料与父节点').click()`,
  );
  await wait(window, `document.body.innerText.includes('已确认材料，未发布')`);
  const reviewList = await wc.executeJavaScript(
    `window.produck.publication.list(${JSON.stringify(first.id)})`,
  );
  assert.equal(reviewList[0].status, "approved");
  assert.equal(reviewList[0].draftId, drafts[0].id);
  assert.equal(reviewList[0].files.length, 3);
  assert.equal(
    (
      await wc.executeJavaScript(
        `window.produck.publication.list(${JSON.stringify(second.id)})`,
      )
    ).length,
    0,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('h3')).find(h=>h.textContent==='发布材料审阅').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  writeFileSync(
    "docs/verification/desktop-publication-review.png",
    (await wc.capturePage()).toPNG(),
  );
  await wc.executeJavaScript(
    `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(document.querySelector('[aria-label="发布文档标题"]'),'客户管理需求');document.querySelector('[aria-label="发布文档标题"]').dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  await wait(
    window,
    `!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='发布到飞书').disabled`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='发布到飞书').click()`,
  );
  await wait(window, `document.body.innerText.includes('已发布并读回验证')`);
  const published = await wc.executeJavaScript(
    `window.produck.publication.runs(${JSON.stringify(first.id)})`,
  );
  assert.equal(published[0].state, "published");
  assert(published[0].steps.every((s) => s.state === "done"));
  assert.equal(feishuFixture.nodes.length, 2);
  await wc.executeJavaScript(
    `window.produck.platforms.save(${JSON.stringify(first.id)}, {provider:'yunxiao',url:'https://devops.aliyun.com/proj',organizationId:'org',projectId:'proj',statusMapping:{published:'design'},secret:'synthetic-yunxiao-token'})`,
  );
  const yunxiaoDb = new DatabaseSync(join(root, "profile", "projects.sqlite"));
  yunxiaoCredentialRef = yunxiaoDb
    .prepare(
      "SELECT credential_ref FROM connections WHERE project_id=? AND provider='yunxiao'",
    )
    .get(first.id).credential_ref;
  yunxiaoDb.close();
  await wc.executeJavaScript(
    `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(document.querySelector('[aria-label="云效工作项 ID"]'),'item');document.querySelector('[aria-label="云效工作项 ID"]').dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  await wait(
    window,
    `!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='读取并准备同步').disabled`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='读取并准备同步').click()`,
  );
  await wait(window, `document.body.innerText.includes('模拟云效需求')`);
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='确认同步状态').click()`,
  );
  await wait(window, `document.body.innerText.includes('云效状态已读回确认')`);
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='读回核对（不重发）').click()`,
  );
  await wait(window, `document.body.innerText.includes('本次没有再次写入')`);
  assert.equal(yunxiaoWrites, 1);
  assert.equal(feishuFixture.nodes.length, 2);
  const syncRows = await wc.executeJavaScript(
    `window.produck.yunxiaoSync.list(${JSON.stringify(first.id)})`,
  );
  assert.equal(syncRows[0].state, "synced");
  assert.equal(syncRows[0].readback.status.id, "design");
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="云效工作项 ID"]').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  writeFileSync(
    "docs/verification/desktop-yunxiao.png",
    (await wc.capturePage()).toPNG(),
  );
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="发布文档标题"]').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  writeFileSync(
    "docs/verification/desktop-published.png",
    (await wc.capturePage()).toPNG(),
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='读取线上最新文档').click()`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="线上文档章节"]') !== null`,
  );
  await wc.executeJavaScript(
    `const select = document.querySelector('[aria-label="线上文档章节"]');select.value = Array.from(select.options).find(o=>o.text==='目标').value;select.dispatchEvent(new Event('change',{bubbles:true}))`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="章节修改内容"]') !== null`,
  );
  await wc.executeJavaScript(
    `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(document.querySelector('[aria-label="章节修改内容"]'),${JSON.stringify("## 目标\n支持筛选、新增客户和状态重置。\n\n")});document.querySelector('[aria-label="章节修改内容"]').dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  await wait(
    window,
    `!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='生成章节差异').disabled`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='生成章节差异').click()`,
  );
  await wait(
    window,
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='重新核对线上并批准差异')`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='重新核对线上并批准差异').click()`,
  );
  await wait(
    window,
    `document.body.innerText.includes('差异已批准，尚未合并')`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('h4')).find(h=>h.textContent.startsWith('差异：')).scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  writeFileSync(
    "docs/verification/desktop-document-diff.png",
    (await wc.capturePage()).toPNG(),
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='检查合并条件').click()`,
  );
  await wait(
    window,
    `document.body.innerText.includes('预检通过：涉及 1 个文字块')`,
  );
  const beforeBuiltinDrafts = await wc.executeJavaScript(
    `window.produck.documents.list(${JSON.stringify(first.id)})`,
  );
  builtinArgs = {
    versionId: drafts[0].versionId,
    stateIds: JSON.stringify(drafts[0].stateIds),
    goal: "BUILTIN_PRD_TEST 草稿",
  };
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('工作流')).click()`,
  );
  await wait(
    window,
    `Array.from(document.querySelector('[aria-label="Agent 技能"]').options).some(o=>o.value==='builtin:prd')`,
  );
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="Agent 技能"]').value='builtin:prd';document.querySelector('[aria-label="Agent 技能"]').dispatchEvent(new Event('change',{bubbles:true}));Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(document.querySelector('[aria-label="Agent 任务要求"]'),'BUILTIN_PRD_TEST');document.querySelector('[aria-label="Agent 任务要求"]').dispatchEvent(new Event('input',{bubbles:true}))`,
  );
  await wait(
    window,
    `!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='执行任务').disabled`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='执行任务').click()`,
  );
  await wait(
    window,
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='批准这一步')`,
  );
  assert.equal(
    (
      await wc.executeJavaScript(
        `window.produck.documents.list(${JSON.stringify(first.id)})`,
      )
    ).length,
    beforeBuiltinDrafts.length,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='批准这一步').click()`,
  );
  await wait(
    window,
    `document.body.innerText.includes('内置技能已保存草稿，等待人工审阅。')`,
  );
  const builtinRuns = await wc.executeJavaScript(
    `window.produck.agent.list(${JSON.stringify(first.id)})`,
  );
  const builtinRun = builtinRuns.find((r) => r.skill?.id === "builtin:prd");
  assert.equal(builtinRun.state, "succeeded");
  assert.deepEqual(
    builtinRun.steps.map((s) => s.call.tool),
    ["product_artifacts", "generate_prd"],
  );
  assert.equal(
    (
      await wc.executeJavaScript(
        `window.produck.documents.list(${JSON.stringify(first.id)})`,
      )
    ).length,
    beforeBuiltinDrafts.length + 1,
  );
  assert.equal(feishuFixture.nodes.length, 2);
  assert.equal(yunxiaoWrites, 1);
  writeFileSync(
    "docs/verification/desktop-agent-prd.png",
    (await wc.capturePage()).toPNG(),
  );
  assert.equal(await wc.executeJavaScript("typeof require"), "undefined");
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: Electron UI project create/select/reload, scoped connections/sources, source import, keychain model configuration, API test, streamed chat, capture, prototype generation/approval/edit, approved PRD screenshots/export and task history",
  );
  await cleanup();
  app.quit();
})().catch(async (e) => {
  await cleanup().catch(() => {});
  console.error(e);
  app.exit(1);
});
