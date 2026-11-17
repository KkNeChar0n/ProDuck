const { app, BrowserWindow, dialog } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
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
        res.end(
          'data: {"choices":[{"delta":{"content":"模型流式响应已验证"}}]}\n\ndata: [DONE]\n\n',
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
  assert.equal(await wc.executeJavaScript("typeof require"), "undefined");
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: Electron UI project create/select/reload, scoped connections/sources, source import, keychain model configuration, API test and streamed chat",
  );
  await cleanup();
  app.quit();
})().catch(async (e) => {
  await cleanup().catch(() => {});
  console.error(e);
  app.exit(1);
});
