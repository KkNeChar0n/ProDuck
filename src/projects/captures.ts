import { readFileSync, existsSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { atomicWrite, projectPath } from "./storage.js";
import type { Capture } from "../contracts/workbench.js";
export function captures(workspace: string): Capture[] {
  const path = projectPath(workspace, "sources/captures.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}
export function saveCapture(
  workspace: string,
  value: Omit<Capture, "id" | "relativePath" | "screenshotPath">,
  png: Uint8Array,
  memoryEligible = true,
): Capture {
  const id = randomUUID(),
    record = {
      ...value,
      ...(memoryEligible ? {} : { memoryEligible: false }),
      id,
      relativePath: `sources/${id}.json`,
      screenshotPath: `sources/${id}.png`,
    };
  atomicWrite(projectPath(workspace, record.screenshotPath), png);
  atomicWrite(
    projectPath(workspace, record.relativePath),
    JSON.stringify(record, null, 2),
  );
  atomicWrite(
    projectPath(workspace, "sources/captures.json"),
    JSON.stringify([...captures(workspace), record], null, 2),
  );
  if (!memoryEligible) return record;
  const note = `# ${value.title.replace(/[\r\n]/g, " ")}\n\n状态：已观察\n来源：[页面采集](../${record.relativePath})\n地址：${value.url}\n采集时间：${value.capturedAt}\n\n## 可见页面内容\n\n${value.text}\n\n## 已记录操作\n\n${value.actions.map((a) => "- " + a).join("\n") || "尚未记录操作。"}\n\n## 待验证\n\n未观察到的权限、后台规则和其他页面状态尚未确认。\n`;
  atomicWrite(projectPath(workspace, `memory/${id}.md`), note);
  writeMemoryIndex(workspace);
  const root = projectPath(workspace, "记忆.md"),
    existing = existsSync(root) ? readFileSync(root, "utf8") : "";
  if (!existing.includes("(memory/页面索引.md)"))
    atomicWrite(root, existing + "\n\n[页面观察索引](memory/页面索引.md)\n");
  return record;
}
export function getCapture(workspace: string, id: string): Capture {
  const item = captures(workspace).find((c) => c.id === id);
  if (!item) throw new Error("当前项目不存在该页面采集");
  return item;
}

export function searchPageMemory(workspace: string, query: string) {
  if (typeof query !== "string" || query.length > 300)
    throw new Error("检索词过长");
  const term = query.trim().toLocaleLowerCase(),
    all = captures(workspace).filter((c) => c.memoryEligible !== false),
    confirmed = confirmations(workspace);
  const isConfirmed = (capture: Capture) =>
    confirmed.some(
      (r) =>
        r.captureId === capture.id && r.contentHash === textHash(capture.text),
    );
  return all
    .filter(
      (c) =>
        !term ||
        `${c.title}\n${c.url}\n${c.text}`.toLocaleLowerCase().includes(term),
    )
    .map((c) => ({
      id: c.id,
      title: c.title,
      url: c.url,
      capturedAt: c.capturedAt,
      text: c.text,
      sourceRef: c.relativePath,
      status: isConfirmed(c) ? ("confirmed" as const) : ("observed" as const),
      conflictsWith: all
        .filter(
          (old) =>
            old.id !== c.id &&
            old.url === c.url &&
            isConfirmed(old) &&
            textHash(old.text) !== textHash(c.text),
        )
        .map((old) => ({
          id: old.id,
          title: old.title,
          text: old.text,
          capturedAt: old.capturedAt,
        })),
    }));
}

interface MemoryConfirmation {
  captureId: string;
  contentHash: string;
  confirmedAt: string;
}
function confirmations(workspace: string): MemoryConfirmation[] {
  const path = projectPath(workspace, "memory/confirmations.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}
function textHash(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
export function confirmPageMemory(workspace: string, captureId: string) {
  const capture = getCapture(workspace, captureId);
  if (capture.memoryEligible === false)
    throw new Error("请审核综合理解文档，自动探索证据不能单独确认为长期记忆");
  const records = confirmations(workspace),
    contentHash = textHash(capture.text);
  if (
    !records.some(
      (r) => r.captureId === captureId && r.contentHash === contentHash,
    )
  )
    records.push({
      captureId,
      contentHash,
      confirmedAt: new Date().toISOString(),
    });
  atomicWrite(
    projectPath(workspace, "memory/confirmations.json"),
    JSON.stringify(records, null, 2),
  );
  const path = projectPath(workspace, `memory/${capture.id}.md`);
  if (existsSync(path))
    atomicWrite(
      path,
      readFileSync(path, "utf8").replace(
        "状态：已观察",
        "状态：用户确认（仅限此采集版本）",
      ),
    );
  writeMemoryIndex(workspace);
  return searchPageMemory(workspace, "");
}

function writeMemoryIndex(workspace: string) {
  const records = confirmations(workspace);
  const index = captures(workspace)
    .filter((c) => c.memoryEligible !== false)
    .map((c) => {
      const confirmed = records.some(
        (r) => r.captureId === c.id && r.contentHash === textHash(c.text),
      );
      return `- [${c.title.replace(/[\[\]\r\n]/g, " ")}](${c.id}.md) — ${c.capturedAt} — ${confirmed ? "用户确认" : "已观察"}`;
    })
    .join("\n");
  atomicWrite(
    projectPath(workspace, "memory/页面索引.md"),
    "# 页面观察索引\n\n" + index + "\n",
  );
}
