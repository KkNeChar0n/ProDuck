import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { verifyRuntime } from "./runtime-manifest.mjs";
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const dmg = resolve(
  process.argv[2] || `release/Produck-${version}-arm64-test.dmg`,
);
const root = mkdtempSync(join(tmpdir(), "produck-package-test-")),
  mount = join(root, "mounted"),
  work = join(root, "work");
let mounted = false;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    timeout: 240000,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status})`);
}
try {
  mkdirSync(mount);
  mkdirSync(work);
  run("/usr/bin/hdiutil", [
    "attach",
    dmg,
    "-readonly",
    "-nobrowse",
    "-mountpoint",
    mount,
  ]);
  mounted = true;
  const bundle = join(root, "Produck.app");
  run("/usr/bin/ditto", [join(mount, "Produck.app"), bundle]);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
  run("/usr/bin/hdiutil", ["detach", mount]);
  mounted = false;
  const appRoot = join(bundle, "Contents/Resources/app"),
    manifest = JSON.parse(
      readFileSync(join(appRoot, "runtime-manifest.json"), "utf8"),
    );
  const count = verifyRuntime(appRoot, manifest);
  // Instrument only this temporary copy. Production runtime bytes remain unchanged.
  mkdirSync(join(appRoot, "scripts"));
  for (const file of ["desktop-smoke.cjs", "feishu-fixture.cjs"])
    cpSync(resolve("scripts", file), join(appRoot, "scripts", file));
  mkdirSync(join(work, "tests/fixtures"), { recursive: true });
  cpSync(
    resolve("tests/fixtures/customers.html"),
    join(work, "tests/fixtures/customers.html"),
  );
  const packagePath = join(appRoot, "package.json"),
    pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  pkg.main = "scripts/desktop-smoke.cjs";
  writeFileSync(packagePath, JSON.stringify(pkg));
  run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bundle]);
  const env = { ...process.env, PRODUCK_TEST_APP_ROOT: appRoot };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  run(join(bundle, "Contents/MacOS/Electron"), ["--without-cli"], {
    cwd: work,
    env,
  });
  verifyRuntime(appRoot, manifest);
  for (const name of [
    "desktop-wide-collapsed.png",
    "desktop-page-paint-retry.png",
  ]) {
    const source = join(work, "docs/verification", name);
    if (existsSync(source)) cpSync(source, resolve("docs/verification", name));
  }
  const report = {
    version,
    checkedAt: new Date().toISOString(),
    filesVerified: count,
    versions: manifest.versions,
    sourceTreeUsedByApp: false,
    cliAvailable: false,
    instrumentation:
      "Temporary copy main entry replaced with test harness; dist and runtime dependencies verified unchanged before and after",
    cleanMachineVerified: false,
  };
  writeFileSync(
    resolve("docs/verification/packaged-runtime.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `PASS: packaged runtime (${count} files), isolated workspace and unavailable CLI`,
  );
} finally {
  if (mounted)
    spawnSync("/usr/bin/hdiutil", ["detach", mount], { stdio: "inherit" });
  rmSync(root, { recursive: true, force: true });
}
