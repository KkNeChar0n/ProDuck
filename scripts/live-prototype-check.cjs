/* Uses the configured model only for synthetic fixture evidence. Never prints credentials. */
const { app, BrowserWindow, webContents } = require("electron");
const { DatabaseSync } = require("node:sqlite");
const { createServer } = require("node:http");
const {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} = require("node:fs");
const { tmpdir, homedir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const temporary = mkdtempSync(join(tmpdir(), "produck-live-check-"));
app.setPath("userData", join(temporary, "profile"));
let server, window, db;
const out = resolve("outputs/live-validation");
mkdirSync(out, { recursive: true });
const moduleAt = (path) => import(pathToFileURL(resolve("dist", path)).href);
(async () => {
  await app.whenReady();
  const settingsDir = join(homedir(), "Library/Application Support/produck");
  const userDb = new DatabaseSync(join(settingsDir, "projects.sqlite"), {
    readOnly: true,
  });
  const state = JSON.parse(
    readFileSync(join(settingsDir, "workspace-state.json"), "utf8"),
  );
  const profile = userDb
    .prepare("SELECT * FROM model_profiles WHERE id=?")
    .get(state.activeProjectId);
  userDb.close();
  if (!profile) throw new Error("当前项目没有模型配置");
  const { openProjectDatabase } = await moduleAt("projects/storage.js"),
    { ProjectRepository } = await moduleAt("projects/repository.js"),
    { saveCapture } = await moduleAt("projects/captures.js"),
    { PrototypeRepository } = await moduleAt("prototypes/repository.js"),
    { ModelService } = await moduleAt("agent/model-service.js"),
    { MacKeychain } = await moduleAt("integrations/credentials.js"),
    { PrototypeGenerator } = await moduleAt("agent/prototype-generator.js"),
    { BrowserSurface, PrototypeSurface } = await moduleAt(
      "desktop/browser-surface.js",
    );
  db = openProjectDatabase(join(temporary, "test.sqlite"));
  const projects = new ProjectRepository(db, join(temporary, "state.json")),
    project = projects.create("合成客户页面验证", temporary);
  const release = projects.createRelease(project.id, "真实模型验收");
  db.prepare(
    "INSERT INTO model_profiles(id,provider,endpoint,model,credential_ref) VALUES(?,?,?,?,?)",
  ).run(
    project.id,
    profile.provider,
    profile.endpoint,
    profile.model,
    profile.credential_ref,
  );
  const models = new ModelService(
      db,
      new MacKeychain(resolve("dist/native/produck-keychain")),
    ),
    versions = new PrototypeRepository(db, projects),
    generator = new PrototypeGenerator(db, projects, models, versions);
  if (process.argv.includes("--connection-only")) {
    const { testModel } = await moduleAt("agent/model-client.js");
    await testModel(await models.request(project.id, "Reply with OK."));
    console.log("Configured model connection check passed.");
    db.close();
    app.quit();
    return;
  }
  server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(readFileSync("tests/fixtures/customers.html"));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
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
    preview = new PrototypeSurface(() => window),
    bounds = { x: 0, y: 0, width: 1000, height: 760 };
  await browser.open(project.id, base);
  browser.show(project.id, bounds);
  const source = webContents
    .getAllWebContents()
    .find((w) => w.getURL() === base + "/");
  await source.executeJavaScript(
    "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
  );
  const initial = await browser.capture(project.id);
  writeFileSync(join(out, "source.png"), initial.png);
  await browser.action(project.id, "fill", "#search", "青禾");
  await browser.action(project.id, "click", "#filters button");
  assert.equal(
    await source.executeJavaScript(
      "document.querySelectorAll('#rows tr').length",
    ),
    1,
  );
  await browser.action(project.id, "click", "#reset");
  await browser.action(project.id, "click", "#add");
  await browser.action(project.id, "click", "#customer-form button.primary");
  assert.equal(
    await source.executeJavaScript("document.querySelector('#dialog').open"),
    true,
  );
  const { png, ...evidence } = await browser.capture(project.id);
  evidence.actions.push(
    "已验证名称搜索、重置、新增弹窗、必填校验；弹窗支持取消；生成原型默认关闭弹窗。",
  );
  const capture = saveCapture(project.workspace, evidence, png);
  console.log(
    "Synthetic page captured; requesting one prototype from the configured model.",
  );
  let last = 0;
  const version = await generator.generate(release.id, capture.id, (event) => {
    if (Date.now() - last > 5000 || event.state !== "running") {
      console.log(`${event.state}: ${event.characters} characters`);
      last = Date.now();
    }
  });
  const html = versions.read(release.id, version.id);
  writeFileSync(join(out, "prototype.html"), html);
  browser.hide();
  await preview.load(html);
  preview.show(bounds);
  const generated = webContents
    .getAllWebContents()
    .find((w) => w.getURL().startsWith("data:"));
  await generated.executeJavaScript(
    "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
  );
  writeFileSync(
    join(out, "prototype.png"),
    (await generated.capturePage()).toPNG(),
  );
  const dom = await generated.executeJavaScript(
    `({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(e=>({text:e.textContent,id:e.id,type:e.type})),inputs:[...document.querySelectorAll('input')].map(e=>({id:e.id,placeholder:e.placeholder,required:e.required})),selects:[...document.querySelectorAll('select')].map(e=>({id:e.id,options:[...e.options].map(o=>o.text)}))})`,
  );
  writeFileSync(join(out, "dom.json"), JSON.stringify(dom, null, 2));
  writeFileSync(
    join(out, "result.json"),
    JSON.stringify(
      {
        status: "generated",
        createdAt: new Date().toISOString(),
        model: profile.model,
        characters: html.length,
        versionId: version.id,
        contentHash: version.contentHash,
        notes: [
          "Synthetic fixture only; no user page data transmitted",
          "Interactions must be validated separately",
          "Screenshot captured but not sent to the model",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    `Generated ${html.length} characters. Outputs saved under outputs/live-validation.`,
  );
  generator.close();
  preview.close();
  browser.close();
  window.destroy();
  server.close();
  db.close();
  app.quit();
})().catch((error) => {
  console.error(error.message);
  server?.close();
  if (db) db.close();
  app.exit(1);
});
