import { runtimeManifest } from "./runtime-manifest.mjs";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  cpSync,
  symlinkSync,
  rmSync,
  renameSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("当前测试包仅支持 macOS arm64");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const output = resolve(`release/Produck-${pkg.version}-arm64-test.dmg`);

const stage = mkdtempSync(join(tmpdir(), "produck-package-"));
const run = (command, args) => {
  const r = spawnSync(command, args, { stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${command} failed (${r.status})`);
};
try {
  const payload = join(stage, "payload");
  mkdirSync(payload);
  const bundle = join(payload, "Produck.app"),
    contents = join(bundle, "Contents"),
    resources = join(contents, "Resources");
  run("/usr/bin/ditto", [
    resolve("node_modules/electron/dist/Electron.app"),
    bundle,
  ]);
  rmSync(join(resources, "default_app.asar"), { force: true });
  const appRoot = join(resources, "app");
  mkdirSync(appRoot, { recursive: true });
  cpSync(resolve("dist"), join(appRoot, "dist"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  writeFileSync(
    join(appRoot, "package.json"),
    JSON.stringify(
      {
        name: "produck",
        productName: "Produck",
        version: pkg.version,
        type: "module",
        main: "dist/desktop/main.js",
      },
      null,
      2,
    ),
  );
  for (const name of ["parse5", "entities"])
    cpSync(resolve("node_modules", name), join(appRoot, "node_modules", name), {
      recursive: true,
    });
  cpSync(resolve("LICENSE"), join(appRoot, "LICENSE"));
  for (const filename of ["LICENSE", "LICENSES.chromium.html"]) {
    const source = resolve("node_modules/electron/dist", filename);
    if (existsSync(source)) cpSync(source, join(resources, filename));
  }
  for (const name of ["react", "react-dom", "scheduler"])
    cpSync(
      resolve(`node_modules/${name}/LICENSE`),
      join(resources, `${name}-LICENSE`),
    );
  const versions = Object.fromEntries(
    ["electron", "parse5", "entities", "react", "react-dom", "scheduler"].map(
      (name) => [
        name,
        JSON.parse(
          readFileSync(resolve("node_modules", name, "package.json"), "utf8"),
        ).version,
      ],
    ),
  );
  versions.python = JSON.parse(
    readFileSync(resolve("scripts/python-runtime.json"), "utf8"),
  ).version;
  writeFileSync(
    join(appRoot, "runtime-manifest.json"),
    JSON.stringify(runtimeManifest(appRoot, versions), null, 2),
  );
  const plist = join(contents, "Info.plist");
  for (const [key, value] of Object.entries({
    CFBundleDisplayName: "Produck",
    CFBundleName: "Produck",
    CFBundleIdentifier: "com.produck.app",
    CFBundleShortVersionString: pkg.version,
    CFBundleVersion: pkg.version,
    LSMinimumSystemVersion: "13.0",
  }))
    run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
  run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bundle]);
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
  symlinkSync("/Applications", join(payload, "Applications"));
  writeFileSync(
    join(payload, "使用说明.txt"),
    `Produck ${pkg.version} 开发测试包（arm64，macOS 13+）\n拖入 Applications 后打开。只作本机开发测试，未完成 Developer ID 签名、公证或干净机器验收。\n已实现项目、模型、页面采集、候选原型和本地 PRD 草稿；已加入受控 Agent 任务和说明型 Skill 导入。飞书首次发布已实现（真实租户待联调），云效同步已实现（真实租户待联调），原文差异合并暂缓，已支持带声明的标准库 Python Skill（网络与子进程禁用），其他脚本和第三方依赖尚不支持，真实模型重建质量暂未验收。\n`,
  );
  mkdirSync("release", { recursive: true });
  run("/usr/bin/hdiutil", [
    "create",
    "-volname",
    "Produck Test",
    "-srcfolder",
    payload,
    "-ov",
    "-format",
    "UDZO",
    join(stage, "Produck.dmg"),
  ]);
  renameSync(join(stage, "Produck.dmg"), output);
  console.log(`Created ${output}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
