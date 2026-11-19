import {
  readFileSync,
  existsSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const config = JSON.parse(
  readFileSync(new URL("./python-runtime.json", import.meta.url), "utf8"),
);
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("Python 测试运行时当前仅支持 macOS arm64");
mkdirSync("vendor", { recursive: true });
const archive = "vendor/python-runtime.tar.gz",
  stamp = "vendor/python-runtime.json";
if (
  !existsSync(stamp) ||
  JSON.parse(readFileSync(stamp, "utf8")).sha256 !== config.sha256 ||
  !existsSync("vendor/python/bin/python3.12")
) {
  if (!existsSync(archive))
    execFileSync(
      "/usr/bin/curl",
      ["--fail", "--location", "--max-time", "180", config.url, "-o", archive],
      { stdio: "inherit" },
    );
  if (
    createHash("sha256").update(readFileSync(archive)).digest("hex") !==
    config.sha256
  )
    throw new Error("Python 下载校验失败，拒绝使用");
  rmSync("vendor/python", { recursive: true, force: true });
  execFileSync("/usr/bin/tar", ["-xzf", archive, "-C", "vendor"]);
  writeFileSync(stamp, JSON.stringify(config, null, 2));
}
rmSync("dist/python", { recursive: true, force: true });
cpSync("vendor/python", "dist/python", {
  recursive: true,
  dereference: false,
  verbatimSymlinks: true,
});
cpSync(stamp, "dist/python/PRODUCK-RUNTIME.json");
console.log(`Bundled Python ${config.version}; no system Python required`);
