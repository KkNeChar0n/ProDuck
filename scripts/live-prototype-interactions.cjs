/* Checks the inspected live-model candidate, not a replacement fixture response. */
const { app, BrowserWindow, webContents } = require("electron");
const { readFileSync, writeFileSync, mkdtempSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
app.setPath(
  "userData",
  mkdtempSync(join(tmpdir(), "produck-candidate-check-")),
);
(async () => {
  await app.whenReady();
  const { PrototypeSurface } = await import(
    pathToFileURL(resolve("dist/desktop/browser-surface.js")).href
  );
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const preview = new PrototypeSurface(() => win);
  const out = resolve("outputs/live-validation");
  const html = readFileSync(join(out, "prototype.html"), "utf8");
  await preview.load(html);
  preview.show({ x: 0, y: 0, width: 1000, height: 760 });
  const page = webContents
    .getAllWebContents()
    .find((w) => w.getURL().startsWith("data:"));
  const run = (script) => page.executeJavaScript(script);
  writeFileSync(join(out, "prototype.png"), (await page.capturePage()).toPNG());
  const checks = [];
  const check = async (name, script) => {
    assert.equal(await run(script), true, name);
    checks.push(name);
  };
  await check(
    "initial rows",
    `document.querySelectorAll('#customer-rows tr').length===3`,
  );
  await check(
    "name search",
    `document.querySelector('#search').value='青禾'; document.querySelector('#filters button').click(); document.querySelectorAll('#customer-rows tr').length===1 && document.querySelector('#customer-rows').innerText.includes('青禾科技')`,
  );
  await check(
    "reset",
    `document.querySelector('#reset').click();document.querySelectorAll('#customer-rows tr').length===3`,
  );
  await check(
    "status filter",
    `document.querySelector('#status').value='跟进中';document.querySelector('#filters button').click();document.querySelectorAll('#customer-rows tr').length===1 && document.querySelector('#customer-rows').innerText.includes('拾光设计')`,
  );
  await check(
    "empty state",
    `document.querySelector('#search').value='不存在的虚构客户';document.querySelector('#filters button').click();document.querySelector('#customer-rows').innerText.includes('暂无匹配客户')`,
  );
  await check(
    "open dialog",
    `document.querySelector('#reset').click();document.querySelector('#add').click();document.querySelector('dialog').open`,
  );
  await check(
    "required validation",
    `document.querySelector('#customer-form button[type=submit]').click();document.querySelector('dialog').open && document.querySelectorAll('[aria-invalid=true]').length===2 && document.querySelectorAll('#customer-rows tr').length===3`,
  );
  writeFileSync(
    join(out, "prototype-validation.png"),
    (await page.capturePage()).toPNG(),
  );
  await check(
    "cancel",
    `document.querySelector('#cancel').click();!document.querySelector('dialog').open && document.querySelectorAll('#customer-rows tr').length===3`,
  );
  await check(
    "simulated success",
    `document.querySelector('#add').click();document.querySelector('#customer-name').value='验收示例';document.querySelector('#customer-owner').value='测试人';document.querySelector('#customer-form button[type=submit]').click();!document.querySelector('dialog').open && document.querySelectorAll('#customer-rows tr').length===4 && document.querySelector('#feedback').innerText.includes('成功')`,
  );
  writeFileSync(
    join(out, "prototype-success.png"),
    (await page.capturePage()).toPNG(),
  );
  writeFileSync(
    join(out, "interactions.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        checks,
        notes: [
          "Selectors target this inspected candidate; other model generations require fresh inspection.",
          "Executed in Produck PrototypeSurface with network disabled.",
        ],
      },
      null,
      2,
    ),
  );
  console.log(`PASS: ${checks.length} live candidate interaction checks`);
  preview.close();
  win.destroy();
  app.quit();
})().catch((e) => {
  console.error(e.message);
  app.exit(1);
});
