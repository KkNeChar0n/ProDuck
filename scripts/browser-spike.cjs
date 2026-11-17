/* Isolated Electron fixture probe: never uses a personal browser profile or real credentials. */
const { app, BrowserWindow, WebContentsView, session } = require("electron");
const { createServer } = require("node:http");
const { mkdtempSync, writeFileSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const assert = require("node:assert/strict");
const profile = mkdtempSync(join(tmpdir(), "produck-browser-spike-"));
app.setPath("userData", profile);
const out = resolve("docs/verification");
mkdirSync(out, { recursive: true });
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.url === "/login" && req.method === "POST") {
    res.writeHead(303, {
      Location: "/customers",
      "Set-Cookie": "session=fixture-user; HttpOnly; SameSite=Strict; Path=/",
    });
    res.end();
    return;
  }
  if (
    req.url === "/customers" &&
    req.headers.cookie?.includes("session=fixture-user")
  ) {
    res.end(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>客户列表</title><style>body{font:16px system-ui;margin:35px;background:#faf9f4}button,input{padding:10px;margin:8px}td{padding:12px;border-bottom:1px solid #ddd}</style></head><body><h1>客户列表</h1><label>搜索客户<input id="search"></label><button id="apply">搜索</button><button id="new">新增客户</button><table><tbody id="rows"></tbody></table><dialog id="dialog"><form id="form"><label>客户名称<input id="name" required></label><button>保存</button><button type="button" id="cancel">取消</button></form></dialog><script>const names=['青禾科技','拾光设计'];const render=()=>{document.querySelector('#rows').replaceChildren(...names.filter(n=>n.includes(document.querySelector('#search').value)).map(n=>{const tr=document.createElement('tr');const td=document.createElement('td');td.textContent=n;tr.append(td);return tr;}));};document.querySelector('#apply').onclick=render;document.querySelector('#new').onclick=()=>document.querySelector('#dialog').showModal();document.querySelector('#cancel').onclick=()=>document.querySelector('#dialog').close();document.querySelector('#form').onsubmit=e=>{e.preventDefault();names.push(document.querySelector('#name').value);document.querySelector('#dialog').close();render();};render();</script></body></html>`,
    );
    return;
  }
  res.end(
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>测试登录</title></head><body><h1>登录测试页面</h1><form method="post" action="/login"><label>演示用户名<input name="username" required></label><button>登录</button></form></body></html>',
  );
});
let window;
const loadFinished = (wc) =>
  new Promise((resolve) => wc.once("did-finish-load", resolve));
async function run() {
  await app.whenReady();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 760,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  const makeView = (partition) => {
    const v = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    window.contentView.addChildView(v);
    v.setBounds({ x: 0, y: 0, width: 1000, height: 760 });
    v.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    return v;
  };
  let a = makeView("persist:project-a");
  await a.webContents.loadURL(base + "/customers");
  assert.equal(
    await a.webContents.executeJavaScript("document.title"),
    "测试登录",
  );
  const login = loadFinished(a.webContents);
  await a.webContents.executeJavaScript(
    `document.querySelector('input').value='fixture-user';document.querySelector('button').click();`,
  );
  await login;
  assert.equal(
    await a.webContents.executeJavaScript("document.title"),
    "客户列表",
  );
  assert.equal(
    await a.webContents.executeJavaScript("typeof require"),
    "undefined",
  );
  assert.equal(
    await a.webContents.executeJavaScript("typeof window.produck"),
    "undefined",
  );
  assert.equal(await a.webContents.executeJavaScript("document.cookie"), "");
  await a.webContents.executeJavaScript(
    `document.querySelector('#search').value='青禾';document.querySelector('#apply').click();`,
  );
  assert.equal(
    await a.webContents.executeJavaScript(
      `document.querySelectorAll('#rows tr').length`,
    ),
    1,
  );
  await a.webContents.executeJavaScript(
    `document.querySelector('#search').value='';document.querySelector('#apply').click();document.querySelector('#new').click();document.querySelector('#form button').click();`,
  );
  assert.equal(
    await a.webContents.executeJavaScript(
      `document.querySelector('#dialog').open`,
    ),
    true,
  );
  await a.webContents.executeJavaScript(
    `document.querySelector('#name').value='模拟新增';document.querySelector('#form button').click();`,
  );
  assert.equal(
    await a.webContents.executeJavaScript(
      `document.querySelectorAll('#rows tr').length`,
    ),
    3,
  );
  const evidence = await a.webContents.executeJavaScript(
    `({url:location.href,title:document.title,text:document.body.innerText,html:document.documentElement.outerHTML})`,
  );
  writeFileSync(
    join(out, "browser-fixture-capture.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log("Fixture interactions passed; capturing visible test window");
  window.show();
  await a.webContents.executeJavaScript(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  const screenshot = await a.webContents.capturePage(
    { x: 0, y: 0, width: 1000, height: 760 },
    { stayHidden: false, stayAwake: true },
  );
  assert(!screenshot.isEmpty());
  writeFileSync(join(out, "browser-fixture.png"), screenshot.toPNG());
  window.contentView.removeChildView(a);
  a.webContents.close();
  a = makeView("persist:project-a");
  await a.webContents.loadURL(base + "/customers");
  assert.equal(
    await a.webContents.executeJavaScript("document.title"),
    "客户列表",
  );
  const b = makeView("persist:project-b");
  await b.webContents.loadURL(base + "/customers");
  assert.equal(
    await b.webContents.executeJavaScript("document.title"),
    "测试登录",
  );
  // Probe actual shell/preload without giving the remote view its bridge.
  const shell = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: resolve("dist/desktop/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const { ipcMain } = require("electron");
  ipcMain.handle("app:info", (e) => {
    assert.equal(e.sender, shell.webContents);
    assert.equal(e.senderFrame, shell.webContents.mainFrame);
    return { name: "produck", version: "0.1.0", platform: process.platform };
  });
  await shell.loadFile(resolve("dist/ui/index.html"));
  const info = await shell.webContents.executeJavaScript(
    "window.produck.getInfo()",
  );
  assert.equal(info.version, "0.1.0");
  assert.equal(
    await shell.webContents.executeJavaScript("typeof require"),
    "undefined",
  );
  shell.destroy();
  const result = {
    status: "passed",
    electron: process.versions.electron,
    checks: [
      "fixture login form submission",
      "httpOnly session not exposed",
      "DOM capture",
      "filter interaction",
      "required form validation",
      "mock submit result",
      "PNG capture",
      "same-project view recreation retains session",
      "other-project session isolated",
      "remote view has no Node or Produck bridge",
      "sandboxed shell preload IPC",
    ],
    limitations: [
      "uses local login fixture; real SSO/CAPTCHA not verified",
      "session recreation checked within one process; cross-process persistence not yet verified",
      "does not test AI reconstruction",
    ],
  };
  writeFileSync(
    join(out, "browser-spike-result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  window.destroy();
  await session.fromPartition("persist:project-a").flushStorageData();
  server.close(() => app.exit(0));
}
run().catch((error) => {
  console.error(error);
  server.close();
  app.exit(1);
});
