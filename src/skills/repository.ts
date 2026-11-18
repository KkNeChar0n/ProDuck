import { agentBuiltins, builtinSkillRecords } from "./agent-builtins.js";
import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { join, relative, resolve, isAbsolute, extname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ProjectRepository } from "../projects/repository.js";
import { atomicWrite, projectPath } from "../projects/storage.js";
import type { ImportedSkill } from "../contracts/skills.js";
const mappings: Record<string, string> = {
  Read: "读取当前项目已导入的资料（read_source）",
  Write: "批准后保存新的工作笔记（write_note）",
  Glob: "列出已导入资料（project_sources）",
  Grep: "检索项目页面记忆（search_memory）",
};
function metadata(text: string, key: string) {
  const header = text.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? "";
  const match = header.match(new RegExp(`^${key}:[ \t]*(.*)$`, "m"));
  if (!match) return "";
  let value = match[1].trim();
  if (/^[>|][+-]?$/.test(value) || !value) {
    const tail = header.slice(match.index! + match[0].length);
    value =
      tail
        .match(/^(?:\n[ \t]+[^\n]*)+/)?.[0]
        .trim()
        .replace(/\n\s*/g, " ")
        .replace(/(?:^|\s)-\s+/g, " ") ?? "";
  }
  return value.replace(/^["']|["']$/g, "");
}
export class SkillRepository {
  constructor(private projects: ProjectRepository) {}
  list(id: string): ImportedSkill[] {
    const path = projectPath(
      this.projects.get(id).workspace,
      "skills/index.json",
    );
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  }
  available(id: string): ImportedSkill[] {
    return [...this.list(id), ...builtinSkillRecords()];
  }
  import(id: string, source: string): ImportedSkill {
    const project = this.projects.get(id),
      root = resolve(source),
      files = new Map<string, Buffer>();
    let bytes = 0;
    if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory())
      throw new Error("请选择普通 Skill 文件夹，不支持符号链接");
    function collect(dir: string, depth: number) {
      if (depth > 12) throw new Error("技能目录层级过深");
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (
          entry.name.startsWith(".") ||
          ["node_modules", "__pycache__"].includes(entry.name)
        )
          continue;
        const full = join(dir, entry.name),
          info = lstatSync(full);
        if (info.isSymbolicLink()) throw new Error("技能资源不能包含符号链接");
        if (info.isDirectory()) collect(full, depth + 1);
        else if (info.isFile()) {
          if (
            info.size > 2 * 1024 * 1024 ||
            (bytes += info.size) > 10 * 1024 * 1024 ||
            files.size >= 200
          )
            throw new Error("技能包超过 10 MB、200 个文件或单文件超过 2 MB");
          files.set(
            relative(root, full).split("\\").join("/"),
            readFileSync(full),
          );
        }
      }
    }
    collect(root, 0);
    const main = files.get("SKILL.md")?.toString("utf8");
    if (!main) throw new Error("所选目录缺少 SKILL.md");
    const reasons: string[] = [],
      requested = new Set<string>();
    for (const [path, content] of files) {
      if (
        [
          ".js",
          ".mjs",
          ".cjs",
          ".ts",
          ".py",
          ".sh",
          ".rb",
          ".exe",
          ".wasm",
        ].includes(extname(path))
      )
        reasons.push(`脚本运行器尚未支持：${path}`);
      if (![".md", ".txt"].includes(extname(path))) {
        if (!/^LICENSE(?:\..*)?$/i.test(path))
          reasons.push(`当前说明型技能不加载此类资源：${path}`);
        continue;
      }
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(content);
      } catch {
        reasons.push(`资源不是 UTF-8 文本：${path}`);
        continue;
      }
      if (content.includes(0)) {
        reasons.push(`资源包含二进制内容：${path}`);
        continue;
      }
      const text = content.toString("utf8");
      for (const match of text.matchAll(
        /\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g,
      )) {
        const link = match[1].replace(/^<|>$/g, "");
        if (/^(https?:|mailto:|#)/i.test(link)) continue;
        const target = resolve(
          root,
          join(path, ".."),
          decodeURIComponent(link.split("#")[0]),
        );
        const rel = relative(root, target);
        if (isAbsolute(rel) || rel === ".." || rel.startsWith("../"))
          throw new Error("技能相对资源引用超出技能包");
        if (
          !files.has(rel) &&
          ![...files.keys()].some((p) => p.startsWith(rel + "/"))
        )
          reasons.push(`引用资源缺失：${link}`);
      }
      if (/(?:\/Users\/|\/home\/|~\/|[A-Z]:\\)/.test(text))
        reasons.push(`包含本机绝对路径：${path}`);
      if (
        /\b(?:python3?|node|npx|bash|zsh|gh|codex|claude)\s+[\w./-]/i.test(text)
      )
        reasons.push(`依赖外部命令或运行时：${path}`);
      if (/\bmcp__[\w]+/.test(text))
        reasons.push(`依赖尚未适配的 MCP 工具：${path}`);
    }
    const tools = metadata(main, "allowed-tools");
    for (const name of tools
      .replace(/[\[\],]/g, " ")
      .split(/\s+/)
      .filter(Boolean))
      requested.add(name);
    const mapped = [...requested].flatMap((name) => {
      if (mappings[name])
        return [{ requested: name, provided: mappings[name] }];
      reasons.push(`未适配宿主工具：${name}`);
      return [];
    });
    const promptText = [...files]
      .filter(([path]) => [".md", ".txt"].includes(extname(path)))
      .map(([path, content]) => `资源：${path}\n${content.toString("utf8")}`)
      .join("\n\n");
    if (promptText.length > 20000)
      reasons.push("说明和文本资源超过当前技能上下文限制（20000 字符）");
    const fingerprint = this.fingerprint(files),
      record: ImportedSkill = {
        id: randomUUID(),
        name: metadata(main, "name") || root.split("/").at(-1)!,
        description: metadata(main, "description") || "未提供描述",
        source: root,
        fingerprint,
        importedAt: new Date().toISOString(),
        resources: [...files.keys()].sort(),
        status: reasons.length
          ? "unsupported"
          : requested.has("Write")
            ? "needs-approval"
            : "runnable",
        reasons: [...new Set(reasons)],
        mappings: mapped,
      };
    for (const [path, bytes] of files)
      atomicWrite(
        projectPath(project.workspace, `skills/${record.id}/${path}`),
        bytes,
      );
    atomicWrite(
      projectPath(project.workspace, "skills/index.json"),
      JSON.stringify([record, ...this.list(id)], null, 2),
    );
    return record;
  }
  private fingerprint(files: Map<string, Buffer>) {
    const hash = createHash("sha256");
    for (const path of [...files.keys()].sort()) {
      hash.update(JSON.stringify([path, files.get(path)!.length]));
      hash.update(files.get(path)!);
    }
    return hash.digest("hex");
  }
  instructions(id: string, skillId: string) {
    this.projects.get(id);
    const builtin = agentBuiltins.find((s) => s.id === skillId);
    if (builtin)
      return {
        id: builtin.id,
        fingerprint: builtin.fingerprint,
        text: builtin.text,
      };
    const record = this.list(id).find((s) => s.id === skillId);
    if (!record) throw new Error("技能不属于当前项目");
    if (record.status === "unsupported")
      throw new Error("技能存在未适配依赖，请先查看兼容性报告");
    const workspace = this.projects.get(id).workspace,
      files = new Map(
        record.resources.map((path) => [
          path,
          readFileSync(projectPath(workspace, `skills/${record.id}/${path}`)),
        ]),
      );
    if (this.fingerprint(files) !== record.fingerprint)
      throw new Error("技能内容已变化，请重新导入以复核依赖和权限");
    return {
      id: record.id,
      fingerprint: record.fingerprint,
      text:
        "Produck 宿主适配：只调用任务提供的原生工具，不直接调用 Read/Write/Glob/Grep。以下是受限替代能力，不支持任意路径读写；能力不足时说明缺项，不尝试绕过。\n" +
        record.mappings
          .map((mapping) => `${mapping.requested} → ${mapping.provided}`)
          .join("\n") +
        "\n\n" +
        [...files]
          .filter(([path]) => [".md", ".txt"].includes(extname(path)))
          .map(
            ([path, content]) => `资源：${path}\n${content.toString("utf8")}`,
          )
          .join("\n\n"),
    };
  }
}
