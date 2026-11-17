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
let server, credentialRef;
async function cleanup() {
  if (credentialRef) {
    const { MacKeychain } = await import("../dist/integrations/credentials.js");
    await new MacKeychain(resolve("dist/native/produck-keychain")).delete(
      credentialRef,
    );
    credentialRef = null;
  }
  if (server) server.close();
}
const root = mkdtempSync(join(tmpdir(), "produck-desktop-test-"));
app.setPath("userData", join(root, "profile"));
writeFileSync(join(root, "handoff.md"), "# 桌面测试交接\n客户筛选规则。");
dialog.showOpenDialog = async (_window, options) => ({
  canceled: false,
  filePaths: [
    options.title === "导入交接资料" ? join(root, "handoff.md") : root,
  ],
});
const ready = new Promise((resolve) =>
  app.once("browser-window-created", (_event, window) =>
    window.webContents.once("did-finish-load", () => resolve(window)),
  ),
);
const wait = async (w, expression) => {
  for (let i = 0; i < 100; i++) {
    if (await w.webContents.executeJavaScript(expression)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("UI condition timed out: " + expression);
};
(async () => {
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
        const content = data.messages[0].content.includes("原型工程师")
          ? require("node:fs").readFileSync(
              "tests/fixtures/customers.html",
              "utf8",
            )
          : data.messages[0].content.includes("Markdown PRD")
            ? "# 客户管理 PRD\n\n## 目标\n支持筛选和新增客户。\n\n## 待确认\n权限规则待确认。"
            : "模型流式响应已验证";
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
