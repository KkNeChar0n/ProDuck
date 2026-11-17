const { app, BrowserWindow, webContents } = require("electron");
const { createServer } = require("node:http");
const {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
app.setPath("userData", mkdtempSync(join(tmpdir(), "produck-surface-test-")));
let hits = 0,
  server,
  window;
(async () => {
  await app.whenReady();
  server = createServer((req, res) => {
    if (req.url === "/side-effect") hits++;
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(readFileSync("tests/fixtures/customers.html"));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { BrowserSurface, PrototypeSurface } = await import(
    pathToFileURL(resolve("dist/desktop/browser-surface.js")).href
  );
  window = new BrowserWindow({
    width: 1000,
    height: 800,
    show: true,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  const browser = new BrowserSurface(() => window),
    preview = new PrototypeSurface(() => window);
  const bounds = { x: 0, y: 0, width: 1000, height: 760 };
  await browser.open("fixture", base);
  browser.show("fixture", bounds);
  const wc = webContents
    .getAllWebContents()
    .find((w) => w.getURL() === base + "/");
  await wc.executeJavaScript(
    "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
  );
  await browser.action("fixture", "fill", "#search", "青禾");
  await browser.action("fixture", "click", "#filters button");
  assert.equal(
    await wc.executeJavaScript("document.querySelectorAll('#rows tr').length"),
    1,
  );
  await browser.action("fixture", "click", "#reset");
  await browser.action("fixture", "click", "#add");
  await browser.action("fixture", "click", "#customer-form button.primary");
  assert.equal(
    await wc.executeJavaScript("document.querySelector('#dialog').open"),
    true,
  );
  await browser.action("fixture", "click", "#cancel");
  await browser.action("fixture", "fill", "#search", "没有此客户");
  await browser.action("fixture", "click", "#filters button");
  assert.equal(
    await wc.executeJavaScript("document.querySelector('#empty').hidden"),
    false,
  );
  await browser.action("fixture", "click", "#reset");
  await browser.action("fixture", "click", "#add");
  await browser.action("fixture", "fill", "#name", "模拟客户");
  await browser.action("fixture", "fill", "#owner", "测试负责人");
  await browser.action("fixture", "click", "#customer-form button.primary");
  assert.equal(
    await wc.executeJavaScript("document.querySelector('#notice').textContent"),
    "客户已保存",
  );
  assert.equal(
    await wc.executeJavaScript("document.querySelector('#dialog').open"),
    false,
  );
  const captured = await browser.capture("fixture");
  assert(captured.text.includes("客户列表"));
  assert(captured.structure.includes("background"));
  assert(captured.actions.length >= 5);
  assert(captured.png.length > 1000);
  mkdirSync("docs/verification", { recursive: true });
  writeFileSync("docs/verification/page-capture.png", captured.png);
  browser.hide();
  await preview.load(
    `<html><body><button id="save" data-produck-id="save">保存</button><a href="${base}/side-effect">外链</a><script>document.querySelector('#save').onclick=()=>{document.body.dataset.saved='true';fetch('${base}/side-effect',{method:'POST'}).catch(()=>{});const image=new Image();image.src='${base}/side-effect';window.open('${base}/side-effect');};</script></body></html>`,
  );
  preview.show(bounds);
  const pw = webContents
    .getAllWebContents()
    .find((w) => w.getURL().startsWith("data:"));
  await preview.selectionMode(true);
  await pw.executeJavaScript("document.querySelector('#save').click()");
  assert.equal((await preview.selection()).id, "save");
  assert.equal(
    await pw.executeJavaScript("document.body.dataset.saved"),
    undefined,
  );
  assert.equal(
    await pw.executeJavaScript("typeof globalThis.__produckPreview"),
    "undefined",
  );
  await preview.selectionMode(false);
  await pw.executeJavaScript("document.querySelector('#save').click()");
  assert.equal(
    await pw.executeJavaScript("document.body.dataset.saved"),
    "true",
  );
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(hits, 0);
  assert.equal(await pw.executeJavaScript("typeof require"), "undefined");
  assert.equal(
    await pw.executeJavaScript("typeof window.produck"),
    "undefined",
  );
  await pw.executeJavaScript("document.querySelector('a').click()");
  await new Promise((r) => setTimeout(r, 100));
  assert(pw.getURL().startsWith("data:"));
  assert.equal(hits, 0);
  const { normalizePrototype } = await import(
    pathToFileURL(resolve("dist/prototypes/identity.js")).href
  );
  const original = normalizePrototype(
    readFileSync("tests/fixtures/customers.html", "utf8").replace(
      "</body>",
      '<input id="secret" type="password"></body>',
    ),
  );
  await preview.load(original);
  preview.show(bounds);
  let view = webContents
    .getAllWebContents()
    .find((w) => w.getURL().startsWith("data:"));
  await view.executeJavaScript(
    `document.querySelector('#search').value='青禾';document.querySelector('#secret').value='do-not-store';document.querySelector('#add').click();document.querySelector('#customer-form input').value='待保存客户';`,
  );
  const saved = await preview.captureState();
  assert(!JSON.stringify(saved).includes("do-not-store"));
  const edited = normalizePrototype(
    original.replace("客户列表", "客户总览"),
    original,
  );
  await preview.load(edited);
  preview.show(bounds);
  const restored = await preview.restoreState(saved);
  assert(restored.restored >= 3);
  assert.equal(restored.skipped, 0);
  view = webContents
    .getAllWebContents()
    .find((w) => w.getURL().startsWith("data:"));
  assert.equal(
    await view.executeJavaScript("document.querySelector('#search').value"),
    "青禾",
  );
  assert.equal(
    await view.executeJavaScript("document.querySelector('#dialog').open"),
    true,
  );
  assert.equal(
    await view.executeJavaScript(
      "document.querySelector('#customer-form input').value",
    ),
    "待保存客户",
  );
  assert.equal(
    await view.executeJavaScript("document.querySelector('#secret').value"),
    "",
  );
  // Selection must intercept even a capture listener installed by the page before mode is enabled.
  await view.executeJavaScript(
    "window.addEventListener('click',()=>document.body.dataset.clicked='yes',true)",
  );
  await preview.selectionMode(true);
  await view.executeJavaScript("document.querySelector('#cancel').click()");
  assert.equal(
    await view.executeJavaScript("document.body.dataset.clicked"),
    undefined,
  );
  assert.equal(
    await view.executeJavaScript("document.querySelector('#dialog').open"),
    true,
  );
  preview.close();
  browser.close();
  window.destroy();
  server.close();
  console.log(
    "PASS: native webpage navigation/actions/capture and isolated prototype blocks fetch, images, popups and navigation",
  );
  app.quit();
})().catch((error) => {
  console.error(error);
  server?.close();
  app.exit(1);
});
