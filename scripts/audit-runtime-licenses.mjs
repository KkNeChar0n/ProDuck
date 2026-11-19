import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
const components = [
  "electron",
  "react",
  "react-dom",
  "scheduler",
  "parse5",
  "entities",
].map((name) => {
  const pkg = JSON.parse(
    readFileSync(`node_modules/${name}/package.json`, "utf8"),
  );
  return { name, version: pkg.version, declaredLicense: pkg.license };
});
const notices = [];
function add(path) {
  const bytes = readFileSync(path);
  notices.push({
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
function walk(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (
      entry.isFile() &&
      /^(?:license(?:s)?|copying|copyright|notice)(?:[.-].*)?$/i.test(
        entry.name,
      )
    )
      add(path);
  }
}
for (const name of ["react", "react-dom", "scheduler", "parse5", "entities"])
  walk(`node_modules/${name}`);
for (const name of ["LICENSE", "LICENSES.chromium.html"]) {
  const path = `node_modules/electron/dist/${name}`;
  if (!existsSync(path)) throw new Error(`缺少许可文件：${path}`);
  add(path);
}
const python = JSON.parse(readFileSync("scripts/python-runtime.json", "utf8"));
if (!existsSync("vendor/python/lib/python3.12/LICENSE.txt"))
  throw new Error("请先运行 npm run build:python");
walk("vendor/python");
walk("third-party/python");
const report = {
  format: 1,
  components,
  python,
  notices: notices.sort((a, b) => a.path.localeCompare(b.path)),
  coverage:
    "Observed notices in current runtime sources; not a complete dependency license determination",
  unresolved: [
    "Python native component notices retained according to matching upstream full-build metadata (third-party/python/components.json)",
    "Electron Chromium third-party notices retained as aggregate, not independently reclassified",
    "No original prd-feishu or prd-feishu-edit scripts redistributed",
  ],
};
writeFileSync(
  "docs/verification/runtime-licenses.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  `Recorded ${components.length} package declarations and ${notices.length} notice files; Python native notices reference matching full-build metadata`,
);
