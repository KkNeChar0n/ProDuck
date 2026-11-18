import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
export function runtimeManifest(root, versions) {
  const files = {};
  function walk(relative) {
    const full = join(root, relative);
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full).sort()) walk(`${relative}/${name}`);
    } else
      files[relative] = createHash("sha256")
        .update(readFileSync(full))
        .digest("hex");
  }
  for (const path of ["dist", "node_modules", "LICENSE"]) walk(path);
  return { format: 1, versions, files };
}
export function verifyRuntime(root, manifest) {
  const actual = runtimeManifest(root, manifest.versions);
  if (JSON.stringify(actual.files) !== JSON.stringify(manifest.files))
    throw new Error("安装包运行资源与清单不一致");
  return Object.keys(actual.files).length;
}
