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
const applicationRoot = process.env.PRODUCK_TEST_APP_ROOT || resolve(".");
const applicationFile = (file) => join(applicationRoot, file);
let server,
  credentialRef,
  platformCredentialRef,
  yunxiaoCredentialRef,
  discoveryCalls = 0,
  discoveryFailures = 0,
  browserConfirmations = 0,
  plannerCalls = 0,
  builtinCalls = 0,
  builtinArgs,
  deliveryPublication,
  importPython = false;
async function cleanup() {
  if (credentialRef) {
    const { MacKeychain } = await import(
      pathToFileURL(applicationFile("dist/integrations/credentials.js")).href
    );
    await new MacKeychain(
      applicationFile("dist/native/produck-keychain"),
    ).delete(credentialRef, platformCredentialRef);
    credentialRef = null;
  }
  if (platformCredentialRef) {
    const { MacKeychain } = await import(
      pathToFileURL(applicationFile("dist/integrations/credentials.js")).href
    );
    await new MacKeychain(
      applicationFile("dist/native/produck-keychain"),
    ).delete(platformCredentialRef);
    platformCredentialRef = null;
  }
  if (yunxiaoCredentialRef) {
    const { MacKeychain } = await import(
      pathToFileURL(applicationFile("dist/integrations/credentials.js")).href
    );
    await new MacKeychain(
      applicationFile("dist/native/produck-keychain"),
    ).delete(yunxiaoCredentialRef);
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
        ? join(root, importPython ? "python-skill" : "skill")
        : root,
  ],
});
mkdirSync(join(root, "python-skill"));
writeFileSync(
  join(root, "python-skill/SKILL.md"),
  "---\nname: desktop-python-fixture\n---\n生成测试结果。",
);
writeFileSync(
  join(root, "python-skill/produck-python.json"),
  JSON.stringify({
    runtime: "python3.12",
    entry: "main.py",
    dependencies: [],
    capabilities: { read: "skill", write: "output", network: false },
  }),
);
writeFileSync(
  join(root, "python-skill/main.py"),
  "import json,sys\ndata=json.load(sys.stdin)\nopen('result.json','w').write(json.dumps(data))\nprint('PYTHON_DESKTOP_OK')\n",
);
const ready = new Promise((resolve) =>
  app.once("browser-window-created", (_event, window) =>
    window.webContents.once("did-finish-load", () => resolve(window)),
  ),
);
const wait = async (w, expression, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
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
    String(url).startsWith("https://devops.cn-hangzhou.aliyuncs.com/")
      ? (async () => {
          assert(
            init.headers.Authorization.startsWith(
              "ACS3-HMAC-SHA256 Credential=synthetic-ak-id,",
            ),
          );
          if (init.method === "POST") {
            assert.deepEqual(JSON.parse(init.body), {
              identifier: "item",
              fieldType: "status",
              propertyKey: "status",
              propertyValue: "design",
            });
            yunxiaoWrites++;
            itemStatus = { id: "design", name: "设计中" };
            return Response.json({ success: true });
          }
          if (String(url).endsWith("/getWorkflowInfo"))
            return Response.json({
              success: true,
              workflow: {
                statuses: [{ identifier: "design", name: "设计中" }],
              },
            });
          if (String(url).endsWith("/project/proj"))
            return Response.json({
              success: true,
              project: {
                identifier: "proj",
                organizationIdentifier: "org",
                logicalStatus: "NORMAL",
                name: "模拟项目",
              },
            });
          return Response.json({
            success: true,
            workitem: {
              identifier: "item",
              subject: "模拟云效需求",
              logicalStatus: "NORMAL",
              spaceIdentifier: "proj",
              workitemTypeIdentifier: "requirement",
              statusIdentifier: itemStatus.id,
              status: itemStatus.name,
              updateStatusAt: 1,
            },
          });
        })()
      : String(url).startsWith("https://openapi-rdc.aliyuncs.com/")
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
        options.buttons.includes("确认同步云效") ||
        options.buttons.includes("授权并运行 Python") ||
        options.buttons.includes("确认，由 Agent 执行一次"),
    );
    if (options.buttons.includes("确认，由 Agent 执行一次"))
      browserConfirmations++;
    return { response: 1, checkboxChecked: false };
  };
  await import(pathToFileURL(applicationFile("dist/desktop/main.js")).href);
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
  assert.equal(state.activeReleaseId, null);
  const releaseState = await wc.executeJavaScript(
    `window.produck.releases.create(${JSON.stringify(first.id)}, 'V1.0.0')`,
  );
  const firstRelease = releaseState.releases[0];
  const releaseWorkspace = join(first.workspace, firstRelease.relativePath);
  await wc.executeJavaScript(
    `window.produck.releases.update(${JSON.stringify(firstRelease.id)}, 'V1.0.0', 'https://example.feishu.cn/wiki/fixture')`,
  );
  await wc.executeJavaScript(
    `window.produck.projects.saveConnection(${JSON.stringify(first.id)},{provider:'feishu',url:'https://example.feishu.cn/wiki/fixture'})`,
  );
  state = await wc.executeJavaScript(
    `window.produck.projects.create('第二个项目')`,
  );
  const second = state.projects.find((p) => p.id !== first.id);
  assert(second);
  const secondState = await wc.executeJavaScript(
    `window.produck.releases.create(${JSON.stringify(second.id)}, 'V1.0.0')`,
  );
  const secondRelease = secondState.releases[0];
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
  let failBatchOnce = true;
  server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      assert.equal(req.headers.authorization, "Bearer synthetic-desktop-token");
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          data: [{ id: "fixture" }, { id: "fixture-alternative" }],
        }),
      );
      return;
    }
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
      assert.equal(data.reasoning_effort, "high");
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
        if (data.messages[0].content.includes("MEMORY_CONTEXT_TEST")) {
          assert(data.messages[0].content.includes("人工核对"));
          assert(data.messages[0].content.includes("理解版本："));
          content = "已使用审核记忆回答";
        }
        if (data.messages[0].content.startsWith("PRODUCK_DISCOVERY_MODULE")) {
          const payload = JSON.parse(
            data.messages[0].content.split("模块资料：")[1],
          );
          content = JSON.stringify({
            understanding: "客户模块已自动整理，包含列表和新增流程",
            flows: ["客户列表→新增→校验与保存"],
            unknowns: ["编辑流程尚未完整覆盖"],
            evidenceIds: [payload.evidence[0].id],
          });
        } else if (
          data.messages[0].content.startsWith("PRODUCK_DISCOVERY_STEP")
        ) {
          if (discoveryCalls === 2 && discoveryFailures < 4) {
            discoveryFailures++;
            res.end("data: [DONE]\n\n");
            return;
          }
          assert(data.messages[0].content.includes("客户筛选规则"));
          discoveryCalls++;
          const page = JSON.parse(
            data.messages[0].content.split("页面证据：")[1],
          );
          const actions = [
            { label: "新增客户", kind: "click", effect: "read" },
            { label: "保存", kind: "click", effect: "write" },
            {
              label: "客户名称",
              kind: "fill",
              value: "虚构客户",
              effect: "read",
            },
            { label: "负责人", kind: "fill", value: "测试人", effect: "read" },
            { label: "保存", kind: "click", effect: "write" },
          ];
          const next = actions[discoveryCalls - 1];
          const target =
            next && page.elements.find((e) => e.label === next.label);
          content = JSON.stringify({
            module: "客户模块",
            featureName: next?.effect === "write" ? undefined : "填写客户名称",
            features: [
              {
                module: "客户模块",
                name: "填写客户名称",
                goal: "核对字段可输入",
                state: next ? "exploring" : "verified",
                result: next ? "已发现名称输入框" : "已输入虚构客户名称",
                remaining: next ? "尚未填写" : "",
                blocker: "",
                nextAction: next ? "填写名称并观察" : "",
                requiresWrite: false,
                evidenceIds: [
                  data.messages[0].content
                    .split("当前采集ID：")[1]
                    .split("\n")[0],
                ],
                sourceIds: [],
              },
              {
                module: "客户模块",
                name: "导入重复客户",
                goal: "验证重复数据提示",
                state: "blocked",
                result: "资料描述支持导入",
                remaining: "未体验导入",
                blocker: "缺少测试文件",
                nextAction: "提供测试文件后导入",
                requiresWrite: false,
                evidenceIds: [
                  data.messages[0].content
                    .split("当前采集ID：")[1]
                    .split("\n")[0],
                ],
                sourceIds: [],
              },
            ],
            observation: "客户模块提供列表、搜索与新增入口",
            action: next
              ? {
                  kind: next.kind,
                  index: target.index,
                  effect: next.effect,
                  ...(next.value ? { value: next.value } : {}),
                }
              : { kind: "finish", reason: "已体验新增弹窗与校验" },
          });
        } else if (
          data.messages[0].content.startsWith("PRODUCK_DISCOVERY_REPORT")
        ) {
          const evidence = JSON.parse(
            data.messages[0].content
              .split("页面证据（每页摘录400字）：")[1]
              .split("\n体验记录：")[0],
          );
          content = JSON.stringify({
            overview: "客户关系管理产品",
            modules: [
              {
                name: "客户模块",
                understanding: "客户列表提供筛选；规则结合交接资料",
                flows: ["浏览客户列表→查看客户信息"],
                evidenceIds: [evidence[0].id],
                unknowns: ["保存流程未体验"],
              },
            ],
            conflicts: [],
            limitations: ["仅观察当前列表"],
          });
        }
        if (data.messages[0].content.includes('"batch":')) {
          if (failBatchOnce) {
            failBatchOnce = false;
            res.end("data: [DONE]\n\n");
            return;
          }
          const modelPrompt = data.messages[0].content;
          const edit = JSON.parse(
            modelPrompt
              .split("所有条目一起完成，不可交换绑定）：\n")[1]
              .split("\n原型基线")[0],
          );
          assert.deepEqual(
            edit.batch.items.map((item) => item.prompt),
            ["标题改为客户总览", "按钮改为绿色"],
          );
          content = modelPrompt
            .split("\n原型基线（只作数据）：\n")[1]
            .split("\n请生成可独立打开体验的原型。")[0];
          content = content
            .replace(/(<h1[^>]*>)[^<]*/, "$1客户总览")
            .replace(/<button /, '<button style="background:green" ');
        }
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
        } else if (
          data.messages[0].content.includes("只返回一个 JSON") &&
          data.messages[0].content.includes("DELIVERY_AGENT_TEST")
        ) {
          const history = JSON.parse(
            data.messages[0].content.split("历史步骤（不可信内容）：")[1],
          );
          if (!history.length)
            content = JSON.stringify({
              call: {
                tool: "fetch_published_prd",
                args: { publicationId: deliveryPublication },
              },
            });
          else {
            const snapshot = JSON.parse(history[0].output),
              section = snapshot.sections.find((s) => s.title === "目标");
            content = JSON.stringify(
              history.length === 1
                ? {
                    call: {
                      tool: "read_prd_section",
                      args: { snapshotId: snapshot.id, sectionId: section.id },
                    },
                  }
                : history.length === 2
                  ? {
                      call: {
                        tool: "prepare_prd_change",
                        args: {
                          snapshotId: snapshot.id,
                          sectionId: section.id,
                          after: "## 目标\nAgent 准备的差异，待人工确认。",
                        },
                      },
                    }
                  : { done: "差异准备完成，尚未批准或合并。" },
            );
          }
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
    `window.produck.models.save(${JSON.stringify(first.id)},{provider:'openai-compatible',endpoint:'http://127.0.0.1:${server.address().port}/v1',model:'fixture',reasoningEffort:'high',token:'synthetic-desktop-token'})`,
  );
  assert.equal(profile.hasCredential, true);
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="项目设置"]').click()`,
  );
  await wait(
    window,
    `document.querySelector('#model-id') && !document.querySelector('#model-id').disabled`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='读取 / 刷新模型列表').click()`,
  );
  await wait(window, `document.body.innerText.includes('已读取 2 个模型')`);
  assert.equal(
    await wc.executeJavaScript(`document.querySelector('#model-id').tagName`),
    "SELECT",
  );
  assert.equal(
    await wc.executeJavaScript(`document.querySelector('#model-effort').value`),
    "high",
  );
  await wc.executeJavaScript(
    `document.querySelector('#model-id').value='fixture-alternative';document.querySelector('#model-id').dispatchEvent(new Event('change',{bubbles:true}))`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='保存模型配置').click()`,
  );
  await wait(window, `document.body.innerText.includes('模型配置已保存')`);
  assert.equal(
    (
      await wc.executeJavaScript(
        `window.produck.models.profile(${JSON.stringify(first.id)})`,
      )
    ).model,
    "fixture-alternative",
  );
  await wc.executeJavaScript(
    `document.querySelector('#model-id').scrollIntoView({block:"start"})`,
  );
  await wc.executeJavaScript(
    `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  writeFileSync(
    "docs/verification/desktop-model-settings.png",
    (await wc.capturePage()).toPNG(),
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('.nav')).find(b=>b.textContent.includes('工作台')).click()`,
  );

  await wait(window, `document.querySelector('[role=tablist]')!==null`);
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('[role=tab]')).find(b=>b.textContent==='交接资料').click()`,
  );
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
  await wait(window, `!!document.querySelector('[aria-label="元素拾取器"]')`);
  const pickSurface = webContents
    .getAllWebContents()
    .find((w) => w.getURL().startsWith("data:"));
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="元素拾取器"]').click()`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="元素拾取器"]').getAttribute('aria-pressed')==='true'`,
  );
  // Two clicks in the same tick must both survive the UI polling interval.
  const pickedIds = await pickSurface.executeJavaScript(
    `(() => { const a=document.querySelector('h1'), b=document.querySelector('button'); a.click(); b.click(); return [a.dataset.produckId,b.dataset.produckId]; })()`,
  );
  await wait(window, `document.querySelectorAll('.element-prompt').length===2`);
  await wc.executeJavaScript(
    `document.querySelectorAll('.element-prompt textarea').forEach((el,i)=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,i===0?'标题改为客户总览':'按钮改为绿色');el.dispatchEvent(new Event('input',{bubbles:true}));})`,
  );
  writeFileSync(
    "docs/verification/desktop-element-prompts.png",
    (await wc.capturePage()).toPNG(),
  );
  const widthBefore = await wc.executeJavaScript(
    `document.querySelector('.native-surface').getBoundingClientRect().width`,
  );
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="收起导航"]').click()`,
  );
  await wait(
    window,
    `document.querySelector('.native-surface').getBoundingClientRect().width > ${widthBefore + 100}`,
  );
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="展开导航"]').click()`,
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
    `document.querySelector('.agent-panel .error')?.textContent.includes('HTML')`,
  );
  assert.deepEqual(
    await wc.executeJavaScript(
      `Array.from(document.querySelectorAll('.element-prompt textarea')).map(el=>el.value)`,
    ),
    ["标题改为客户总览", "按钮改为绿色"],
  );
  await wait(
    window,
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='重试原型生成' && !b.disabled)`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='重试原型生成').scrollIntoView({block:'center'})`,
  );
  await wc.executeJavaScript(
    `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  writeFileSync(
    "docs/verification/desktop-prototype-retry.png",
    (await wc.capturePage()).toPNG(),
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='重试原型生成').click()`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="原型版本"]')?.options.length===2`,
  );
  const versionList = await wc.executeJavaScript(
    `window.produck.workbench.versions(${JSON.stringify(firstRelease.id)})`,
  );
  const batchDetails = await wc.executeJavaScript(
    `window.produck.workbench.details(${JSON.stringify(firstRelease.id)},${JSON.stringify(versionList[0].id)})`,
  );
  assert.deepEqual(batchDetails.batch.items, [
    { elementId: pickedIds[0], prompt: "标题改为客户总览" },
    { elementId: pickedIds[1], prompt: "按钮改为绿色" },
  ]);
  assert.equal(batchDetails.batch.baselineId, versionList[1].id);
  assert.equal(batchDetails.batch.contentHash, versionList[1].contentHash);
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
  await wait(window, `!!document.querySelector('[aria-label="元素拾取器"]')`);
  const prototypeContents = webContents
    .getAllWebContents()
    .find((w) => w.getURL().startsWith("data:"));
  assert(prototypeContents);
  assert.equal(
    await prototypeContents.executeJavaScript(
      "document.querySelector('h1').textContent",
    ),
    "客户总览",
  );
  assert.equal(
    await prototypeContents.executeJavaScript(
      "document.querySelector('button').style.background",
    ),
    "green",
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
      `window.produck.documents.generate(${JSON.stringify(firstRelease.id)},${JSON.stringify(versionList[0].id)},['x'],'')`,
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
    `window.produck.documents.list(${JSON.stringify(firstRelease.id)})`,
  );
  assert.equal(drafts[0].versionId, versionList[0].id);
  await wc.executeJavaScript(
    `window.produck.documents.export(${JSON.stringify(firstRelease.id)},${JSON.stringify(drafts[0].id)})`,
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
    `window.produck.workbench.tasks(${JSON.stringify(firstRelease.id)})`,
  );
  assert.equal(tasks.length, 3);
  assert.equal(
    tasks.filter((t) => t.state === "succeeded" && !t.recoverable).length,
    2,
  );
  assert.equal(
    tasks.filter((t) => t.state === "failed" && t.recoverable).length,
    1,
  );
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
        `document.querySelector('[aria-label="产品 Chrome 地址"]') !== null`,
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
    `document.querySelector('[aria-label="Agent 技能"]')?.options.length===5`,
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
    `window.produck.agent.list(${JSON.stringify(firstRelease.id)})`,
  );
  assert.equal(agentRuns[0].state, "succeeded");
  assert.equal(agentRuns[0].steps.length, 2);
  assert.equal(plannerCalls, 3);
  assert.equal(agentRuns[0].skill.fingerprint, importedSkills[0].fingerprint);
  assert(
    require("node:fs")
      .readdirSync(join(releaseWorkspace, "workflows"))
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
    `document.querySelector('[aria-label="项目设置"]').click()`,
  );
  await wait(window, `document.querySelector('input[name=appId]') !== null`);
  assert.equal(
    await wc.executeJavaScript(
      `document.querySelector('[aria-label="飞书迭代父节点地址"]') === null`,
    ),
    true,
  );
  assert.equal(
    await wc.executeJavaScript(
      `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === '配置项目')`,
    ),
    false,
  );
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
  await wait(window, `document.body.innerText.includes('飞书应用鉴权成功')`);
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
    `window.produck.publication.list(${JSON.stringify(firstRelease.id)})`,
  );
  assert.equal(reviewList[0].status, "approved");
  assert.equal(reviewList[0].draftId, drafts[0].id);
  assert.equal(reviewList[0].files.length, 3);
  assert.equal(
    (
      await wc.executeJavaScript(
        `window.produck.publication.list(${JSON.stringify(secondRelease.id)})`,
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
    `window.produck.publication.runs(${JSON.stringify(firstRelease.id)})`,
  );
  assert.equal(published[0].state, "published");
  assert(published[0].steps.every((s) => s.state === "done"));
  assert.equal(feishuFixture.nodes.length, 2);
  await wc.executeJavaScript(
    `window.produck.platforms.save(${JSON.stringify(first.id)}, {provider:'yunxiao',url:'https://devops.aliyun.com/proj',organizationId:'org',projectId:'proj',authType:'ak',accessKeyId:'synthetic-ak-id',statusMapping:{published:'design'},secret:'synthetic-ak-secret'})`,
  );
  const yunxiaoDb = new DatabaseSync(join(root, "profile", "projects.sqlite"));
  yunxiaoCredentialRef = yunxiaoDb
    .prepare(
      "SELECT credential_ref FROM connections WHERE project_id=? AND provider='yunxiao'",
    )
    .get(first.id).credential_ref;
  yunxiaoDb.close();
  const akTest = await wc.executeJavaScript(
    `window.produck.platforms.test(${JSON.stringify(first.id)},'yunxiao')`,
  );
  assert.equal(akTest.title, "模拟项目");

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
    `window.produck.yunxiaoSync.list(${JSON.stringify(firstRelease.id)})`,
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
    `window.produck.documents.list(${JSON.stringify(firstRelease.id)})`,
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
        `window.produck.documents.list(${JSON.stringify(firstRelease.id)})`,
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
    `window.produck.agent.list(${JSON.stringify(firstRelease.id)})`,
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
        `window.produck.documents.list(${JSON.stringify(firstRelease.id)})`,
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
  deliveryPublication = published[0].id;
  const deliveryRun = await wc.executeJavaScript(
    `window.produck.agent.start(${JSON.stringify(firstRelease.id)},'DELIVERY_AGENT_TEST',6,'builtin:delivery')`,
  );
  for (let n = 0; n < 200; n++) {
    const runs = await wc.executeJavaScript(
      `window.produck.agent.list(${JSON.stringify(firstRelease.id)})`,
    );
    const current = runs.find((r) => r.id === deliveryRun.id);
    if (current.state === "succeeded") break;
    assert(
      !["failed", "cancelled", "interrupted"].includes(current.state),
      current.message,
    );
    if (current.state === "waiting-user")
      await wc.executeJavaScript(
        `window.produck.agent.approve(${JSON.stringify(firstRelease.id)},${JSON.stringify(current.id)},${JSON.stringify(current.steps.at(-1).id)},true)`,
      );
    await new Promise((r) => setTimeout(r, 50));
  }
  const saved = await wc.executeJavaScript(
    `window.produck.documentReviews.saved(${JSON.stringify(firstRelease.id)},${JSON.stringify(published[0].id)})`,
  );
  assert.equal(saved.review.state, "pending");
  assert(saved.review.after.includes("Agent 准备的差异"));
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('文档')).click()`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="文档草稿"]') !== null`,
  );
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="文档草稿"]').value=${JSON.stringify(drafts[0].id)};document.querySelector('[aria-label="文档草稿"]').dispatchEvent(new Event('change',{bubbles:true}))`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="章节修改内容"]')?.value.includes('Agent 准备的差异')`,
  );
  assert.equal(feishuFixture.nodes.length, 2);
  assert.equal(yunxiaoWrites, 1);
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="章节修改内容"]').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  writeFileSync(
    "docs/verification/desktop-agent-delivery.png",
    (await wc.capturePage()).toPNG(),
  );
  importPython = true;
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('Skills')).click()`,
  );
  await wait(
    window,
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='导入 Skill 文件夹')`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='导入 Skill 文件夹').click()`,
  );
  await wait(
    window,
    `document.body.innerText.includes('desktop-python-fixture')`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='运行 Python 脚本').click()`,
  );
  await wait(window, `document.body.innerText.includes('PYTHON_DESKTOP_OK')`);
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('h3')).find(h=>h.textContent.includes('desktop-python-fixture')).scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  writeFileSync(
    "docs/verification/desktop-python.png",
    (await wc.capturePage()).toPNG(),
  );
  // Exercise the product-release UI and ensure an existing publication stays in V1.
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="创建版本"]').click()`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="新版本名称"]') !== null`,
  );
  await wc.executeJavaScript(
    `{ const input=document.querySelector('[aria-label="新版本名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'V2.0.0');input.dispatchEvent(new Event('input',{bubbles:true})); }`,
  );
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="新版本名称"]').form.requestSubmit()`,
  );
  await wait(window, `document.body.innerText.includes('从旧版本复制原型')`);
  assert.equal(
    await wc.executeJavaScript(
      `document.querySelector('input[name=appId]') === null`,
    ),
    true,
  );
  const nextState = await wc.executeJavaScript(
    `window.produck.projects.state()`,
  );
  const nextRelease = nextState.activeReleaseId;
  assert.notEqual(nextRelease, firstRelease.id);
  assert.deepEqual(
    await wc.executeJavaScript(
      `window.produck.documents.list(${JSON.stringify(nextRelease)})`,
    ),
    [],
  );
  assert.deepEqual(
    await wc.executeJavaScript(
      `window.produck.publication.runs(${JSON.stringify(nextRelease)})`,
    ),
    [],
  );
  assert.equal(
    (
      await wc.executeJavaScript(
        `window.produck.platforms.profile(${JSON.stringify(nextRelease)},'feishu')`,
      )
    ).url,
    "",
  );
  await wc.executeJavaScript(
    `{ const input=document.querySelector('[aria-label="飞书迭代父节点地址"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'https://example.feishu.cn/wiki/next');input.dispatchEvent(new Event('input',{bubbles:true})); }`,
  );
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="飞书迭代父节点地址"]').form.requestSubmit()`,
  );
  await wait(window, `document.body.innerText.includes('版本设置已保存')`);
  assert.equal(
    (
      await wc.executeJavaScript(
        `window.produck.platforms.profile(${JSON.stringify(firstRelease.id)},'feishu')`,
      )
    ).url,
    "https://example.feishu.cn/wiki/fixture",
  );
  await wc.executeJavaScript(
    `{ const select=document.querySelector('[aria-label="来源产品版本"]');select.value=${JSON.stringify(firstRelease.id)};select.dispatchEvent(new Event('change',{bubbles:true})); }`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="来源原型"]')?.options.length > 1`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='复制到当前版本').click()`,
  );
  await wait(window, `document.body.innerText.includes('已复制为未批准候选')`);
  const copies = await wc.executeJavaScript(
    `window.produck.workbench.versions(${JSON.stringify(nextRelease)})`,
  );
  assert.equal(copies.length, 1);
  assert.equal(copies[0].approved, false);
  writeFileSync(
    "docs/verification/desktop-releases.png",
    (await wc.capturePage()).toPNG(),
  );
  await wc.executeJavaScript(
    `{ const select=document.querySelector('[aria-label="切换版本"]');select.value=${JSON.stringify(firstRelease.id)};select.dispatchEvent(new Event('change',{bubbles:true})); }`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="切换版本"]')?.value===${JSON.stringify(firstRelease.id)}`,
  );
  assert.equal(
    (
      await wc.executeJavaScript(
        `window.produck.publication.runs(${JSON.stringify(firstRelease.id)})`,
      )
    )[0].id,
    published[0].id,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('.nav')).find(b=>b.textContent.includes('工作台')).click()`,
  );
  await wait(
    window,
    `Array.from(document.querySelectorAll('[role=tab]')).some(b=>b.textContent==='理解产品')`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('[role=tab]')).find(b=>b.textContent==='理解产品').click()`,
  );
  await wait(
    window,
    `!!document.querySelector('[aria-label="产品 Chrome 地址"]')`,
  );
  await wc.executeJavaScript(
    `{const e=document.querySelector('[aria-label="产品 Chrome 地址"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'http://127.0.0.1:${server.address().port}/customers');e.dispatchEvent(new Event('input',{bubbles:true}));}`,
  );
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="产品 Chrome 地址"]').form.requestSubmit()`,
  );
  await wait(
    window,
    `document.body.innerText.includes('Chrome 已打开') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='授权并开始自动体验' && !b.disabled)`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='授权并开始自动体验').click()`,
  );
  await wait(
    window,
    `(async()=>{const s=await window.produck.discovery.state(${JSON.stringify(firstRelease.id)});return s.run?.state==='paused'})()`,
    60000,
  );
  await wait(
    window,
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='继续探索' && !b.disabled)`,
  );
  assert.equal(
    await wc.executeJavaScript(
      `document.body.innerText.includes('授权并继续自动体验')`,
    ),
    false,
  );
  const pausedDiscovery = await wc.executeJavaScript(
    `window.produck.discovery.state(${JSON.stringify(firstRelease.id)})`,
  );
  assert.equal(pausedDiscovery.reports.length, 0);
  assert.equal(pausedDiscovery.run.retries.length, 3);
  assert(pausedDiscovery.run.message.includes("自动重试 3 次后仍失败"));
  assert(pausedDiscovery.run.modules.some((m) => m.markdown));
  await wc.executeJavaScript(
    `{const e=document.querySelector('[aria-label="探索步数"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'60');e.dispatchEvent(new Event('input',{bubbles:true}));}`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='继续探索').click()`,
  );
  await wait(
    window,
    `!!document.querySelector('[aria-label="模块理解 Markdown"]')`,
    60000,
  );
  const draftUnderstanding = await wc.executeJavaScript(
    `window.produck.discovery.state(${JSON.stringify(firstRelease.id)})`,
  );
  assert.equal(
    draftUnderstanding.run.budget - pausedDiscovery.run.captureIds.length,
    60,
  );
  assert.equal(
    draftUnderstanding.run.roundStart,
    pausedDiscovery.run.captureIds.length,
  );
  assert(
    draftUnderstanding.run.modules.some((m) =>
      m.markdown.includes("客户模块已自动整理"),
    ),
  );
  await wc.executeJavaScript(
    `{const section=document.querySelector('[aria-label="探索进度总览"]');section.querySelector('details').open=true;section.scrollIntoView({block:'start'});}`,
  );
  await wc.executeJavaScript(
    `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  writeFileSync(
    "docs/verification/desktop-discovery-modules.png",
    (await wc.capturePage()).toPNG(),
  );
  assert.equal(
    await wc.executeJavaScript(
      `document.querySelector('[aria-label="清单验证进度"]').value`,
    ),
    50,
  );
  assert(
    await wc.executeJavaScript(
      `document.querySelector('[aria-label="探索进度总览"]').textContent.includes('50%')`,
    ),
  );
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="探索进度总览"]').scrollIntoView({block:'start'})`,
  );
  await wc.executeJavaScript(
    `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  writeFileSync(
    "docs/verification/desktop-discovery-progress.png",
    (await wc.capturePage()).toPNG(),
  );
  assert.equal(draftUnderstanding.run.features.length, 2);
  assert.equal(
    await wc.executeJavaScript(
      `document.querySelector('[aria-label="模块探索进度"]') === null`,
    ),
    true,
  );
  assert.equal(draftUnderstanding.activeReportId, null);
  assert.equal(browserConfirmations, 1);
  assert(draftUnderstanding.reports[0].markdown.includes("客户模块"));
  await wc.executeJavaScript(
    `{const e=document.querySelector('[aria-label="模块理解 Markdown"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,e.value+${JSON.stringify("\n人工核对：客户模块需保留搜索。")});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='保存修订').click()`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="产品理解版本"]').options.length===2`,
  );
  await wc.executeJavaScript(
    `document.querySelector('.understanding-review').scrollIntoView({block:'start'})`,
  );
  await wc.executeJavaScript(
    `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
  );
  writeFileSync(
    "docs/verification/desktop-discovery-review.png",
    (await wc.capturePage()).toPNG(),
  );
  const beforeDiscoveryVersions = await wc.executeJavaScript(
    `window.produck.workbench.versions(${JSON.stringify(firstRelease.id)})`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='审核通过并生成原型').click()`,
  );
  await wait(
    window,
    `document.querySelector('[aria-label="原型版本"]')?.options.length===${beforeDiscoveryVersions.length + 1}`,
    60000,
  );
  await wait(window, `!!document.querySelector('[aria-label="元素拾取器"]')`);
  const reviewedUnderstanding = await wc.executeJavaScript(
    `window.produck.discovery.state(${JSON.stringify(firstRelease.id)})`,
  );
  const activeUnderstanding = reviewedUnderstanding.reports.find(
    (r) => r.id === reviewedUnderstanding.activeReportId,
  );
  assert(activeUnderstanding.approvedAt);
  assert(activeUnderstanding.markdown.includes("人工核对"));
  const isolatedUnderstanding = await wc.executeJavaScript(
    `window.produck.discovery.state(${JSON.stringify(nextRelease)})`,
  );
  assert.equal(isolatedUnderstanding.activeReportId, activeUnderstanding.id);
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('[role=tab]')).find(b=>b.textContent==='理解产品').click()`,
  );
  await wait(
    window,
    `Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='继续探索' && !b.disabled)`,
  );
  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='继续探索').click()`,
  );
  await wait(
    window,
    `(async()=>{const s=await window.produck.discovery.state(${JSON.stringify(firstRelease.id)});return s.run.id!==${JSON.stringify(reviewedUnderstanding.run.id)} && s.run.state==='draft'})()`,
    60000,
  );
  const continuedUnderstanding = await wc.executeJavaScript(
    `window.produck.discovery.state(${JSON.stringify(firstRelease.id)})`,
  );
  assert.equal(
    continuedUnderstanding.run.continuedFrom,
    reviewedUnderstanding.run.id,
  );
  assert.equal(
    continuedUnderstanding.run.roundStart,
    reviewedUnderstanding.run.captureIds.length,
  );
  assert(
    continuedUnderstanding.run.captureIds.length >
      reviewedUnderstanding.run.captureIds.length,
  );
  assert.equal(continuedUnderstanding.activeReportId, activeUnderstanding.id);
  assert(
    continuedUnderstanding.reports.some(
      (r) => r.id === activeUnderstanding.id && r.approvedAt,
    ),
  );
  await wait(
    window,
    `document.body.innerText.includes('累计') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='继续探索' && !b.disabled)`,
    60000,
  );
  writeFileSync(
    "docs/verification/desktop-discovery-continue.png",
    (await wc.capturePage()).toPNG(),
  );

  await wc.executeJavaScript(
    `Array.from(document.querySelectorAll('.nav')).find(b=>b.textContent.includes('项目记忆')).click()`,
  );
  await wait(window, `document.body.innerText.includes('人工核对')`);
  writeFileSync(
    "docs/verification/desktop-understanding-memory.png",
    (await wc.capturePage()).toPNG(),
  );
  await wc.executeJavaScript(
    `{const e=document.querySelector('[aria-label="修改要求"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'MEMORY_CONTEXT_TEST');e.dispatchEvent(new Event('input',{bubbles:true}));}`,
  );
  await wc.executeJavaScript(
    `document.querySelector('[aria-label="发送修改要求"]').click()`,
  );
  await wait(window, `document.body.innerText.includes('已使用审核记忆回答')`);
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
