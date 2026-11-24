// Explicit opt-in live model acceptance on synthetic local data only.
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { openProjectDatabase } from "../dist/projects/storage.js";
import { ProjectRepository } from "../dist/projects/repository.js";
import { ModelService } from "../dist/agent/model-service.js";
import { MacKeychain } from "../dist/integrations/credentials.js";
import { ChromeDiscoveryBrowser } from "../dist/discovery/chrome.js";
import { DiscoveryService, discoveryModel } from "../dist/discovery/service.js";

if (!process.argv.includes("--use-configured-model"))
  throw new Error(
    "Pass --use-configured-model to spend model usage on synthetic acceptance data.",
  );
const settings = join(homedir(), "Library/Application Support/produck");
const state = JSON.parse(
  readFileSync(join(settings, "workspace-state.json"), "utf8"),
);
const userDb = new DatabaseSync(join(settings, "projects.sqlite"), {
  readOnly: true,
});
const profile = userDb
  .prepare("SELECT * FROM model_profiles WHERE id=?")
  .get(state.activeProjectId);
userDb.close();
if (!profile) throw new Error("当前项目没有模型配置");
const root = mkdtempSync(join(tmpdir(), "produck-live-discovery-"));
const out = resolve("outputs/live-discovery");
mkdirSync(out, { recursive: true });
const db = openProjectDatabase(join(root, "test.sqlite"));
const projects = new ProjectRepository(db, join(root, "state.json"));
const project = projects.create("虚构客户产品验收", root);
const release = projects.createRelease(project.id, "真实模型验收");
db.prepare("INSERT INTO model_profiles VALUES(?,?,?,?,?)").run(
  project.id,
  profile.provider,
  profile.endpoint,
  profile.model,
  profile.credential_ref,
);
const models = new ModelService(
  db,
  new MacKeychain(resolve("dist/native/produck-keychain")),
);
let confirmations = 0;
const server = createServer((req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end();
    return;
  }
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(readFileSync("tests/fixtures/customers.html"));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = new ChromeDiscoveryBrowser(
  join(root, "chrome"),
  async (detail) => {
    // Test-only consent: this fixture has no backend and only changes in-memory rows.
    if (!detail.page.includes(origin)) return false;
    confirmations++;
    return true;
  },
);
const service = new DiscoveryService(projects, browser, discoveryModel(models));
try {
  await service.open(release.id, origin);
  await delay(700);
  await service.start(
    release.id,
    "体验客户列表的名称搜索、状态筛选、重置与空态，新增弹窗的必填校验、取消和成功反馈。仅使用虚构测试数据。准确区分实际观察与未覆盖流程。",
    20,
  );
  const deadline = Date.now() + 12 * 60 * 1000;
  let count = -1,
    result;
  while (Date.now() < deadline) {
    result = service.state(release.id);
    if (result.run.steps.length !== count) {
      count = result.run.steps.length;
      console.log(`Observed ${count} steps; ${result.run.state}`);
    }
    if (result.run.state !== "running") break;
    await delay(1000);
  }
  if (result.run.state === "running") {
    await service.cancel(release.id);
    result = service.state(release.id);
  }
  writeFileSync(
    join(out, "result.json"),
    JSON.stringify(
      {
        model: profile.model,
        confirmations,
        workspace: project.workspace,
        ...result,
      },
      null,
      2,
    ),
  );
  for (const report of result.reports)
    writeFileSync(join(out, "understanding.md"), report.markdown);
  console.log(`Result: ${result.run.state}; ${result.run.message}`);
  if (result.run.state !== "draft") process.exitCode = 1;
} finally {
  await service.close();
  db.close();
  server.close();
}
