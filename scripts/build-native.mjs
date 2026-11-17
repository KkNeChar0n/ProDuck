import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
if (process.platform !== "darwin")
  throw new Error("The current native credential helper requires macOS");
mkdirSync("dist/native", { recursive: true });
const result = spawnSync(
  "xcrun",
  [
    "swiftc",
    "native/Keychain.swift",
    "-O",
    "-target",
    `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macosx13.0`,
    "-module-cache-path",
    join(tmpdir(), "produck-swift-module-cache"),
    "-o",
    "dist/native/produck-keychain",
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
