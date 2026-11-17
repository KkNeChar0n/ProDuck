import { readFileSync, statSync, existsSync, unlinkSync } from "node:fs";
import { basename, extname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicWrite, projectPath } from "./storage.js";
import type { SourceDocument } from "../contracts/sources.js";
export function listSources(workspace: string): SourceDocument[] {
  const path = projectPath(workspace, "sources/index.json");
  if (!existsSync(path)) return [];
  const records = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(records)) throw new Error("资料索引格式无效");
  return records;
}
export function importSource(workspace: string, input: string): SourceDocument {
  const extension = extname(input).toLowerCase();
  if (![".md", ".txt", ".html", ".htm"].includes(extension))
    throw new Error("支持 Markdown、纯文本和 HTML；请先将其他格式转换后导入");
  const info = statSync(input);
  if (!info.isFile() || info.size > 5 * 1024 * 1024)
    throw new Error("请选择不超过 5 MB 的文本文件");
  const bytes = readFileSync(input);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("文件不是 UTF-8 文本，请转换编码后重试");
  }
  if (bytes.includes(0)) throw new Error("文件包含二进制内容，请选择文本资料");
  const id = randomUUID(),
    relativePath = `sources/${id}${extension}`,
    destination = projectPath(workspace, relativePath),
    index = listSources(workspace);
  const record: SourceDocument = {
    id,
    name: basename(input),
    relativePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    importedAt: new Date().toISOString(),
    bytes: bytes.length,
  };
  atomicWrite(destination, bytes);
  try {
    atomicWrite(
      projectPath(workspace, "sources/index.json"),
      JSON.stringify([...index, record], null, 2),
    );
  } catch (error) {
    unlinkSync(destination);
    throw error;
  }
  return record;
}
