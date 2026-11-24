import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { DiscoveryRun, Understanding } from "../contracts/discovery.js";
import type { ProjectRepository } from "../projects/repository.js";
import { atomicWrite, projectPath } from "../projects/storage.js";
import { getCapture } from "../projects/captures.js";
export const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export class UnderstandingRepository {
  constructor(private projects: ProjectRepository) {}
  private path(scope: string, relative: string) {
    return projectPath(this.projects.shared(scope).workspace, relative);
  }
  private id(value: string) {
    if (!/^[a-f0-9-]{36}$/i.test(value)) throw new Error("理解记录标识无效");
    return value;
  }
  saveRun(scope: string, run: DiscoveryRun) {
    if (run.projectId !== this.projects.shared(scope).id)
      throw new Error("任务不属于当前项目");
    atomicWrite(
      this.path(scope, `discovery/runs/${this.id(run.id)}.json`),
      JSON.stringify(run, null, 2),
    );
  }
  runs(scope: string): DiscoveryRun[] {
    const directory = this.path(scope, "discovery/runs");
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((n) => /^[a-f0-9-]{36}\.json$/i.test(n))
      .map(
        (n) =>
          JSON.parse(
            readFileSync(this.path(scope, `discovery/runs/${n}`), "utf8"),
          ) as DiscoveryRun,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  run(scope: string, id: string) {
    const run = this.runs(scope).find((r) => r.id === id);
    if (!run) throw new Error("理解任务不属于当前项目");
    return run;
  }
  private evidence(scope: string, run: DiscoveryRun) {
    const workspace = this.projects.shared(scope).workspace;
    return digest(
      JSON.stringify({
        captures: run.captureIds.map((id) => {
          const c = getCapture(workspace, id);
          const raw = readFileSync(
            projectPath(workspace, c.relativePath),
            "utf8",
          );
          if (JSON.stringify(JSON.parse(raw)) !== JSON.stringify(c))
            throw new Error("页面证据索引与文件不一致");
          return {
            id,
            record: digest(raw),
            image: digest(
              readFileSync(projectPath(workspace, c.screenshotPath)),
            ),
          };
        }),
        sources: run.sources.map((s) => ({
          id: s.id,
          sha256: s.sha256,
          text: s.text,
          truncated: s.truncated,
        })),
        steps: run.steps,
      }),
    );
  }
  create(scope: string, run: DiscoveryRun, markdown: string): Understanding {
    if (
      typeof markdown !== "string" ||
      !markdown.trim() ||
      markdown.length > 18000
    )
      throw new Error("理解文档需要 1–18000 字");
    const evidenceHash = this.evidence(scope, run);
    const report: Understanding = {
      id: randomUUID(),
      runId: run.id,
      createdAt: new Date().toISOString(),
      markdown,
      captureIds: [...run.captureIds],
      evidenceHash,
      digest: digest(
        JSON.stringify({ markdown, captureIds: run.captureIds, evidenceHash }),
      ),
    };
    atomicWrite(
      this.path(scope, `discovery/reports/${report.id}.md`),
      markdown,
    );
    atomicWrite(
      this.path(scope, `discovery/reports/${report.id}.json`),
      JSON.stringify(report, null, 2),
    );
    return report;
  }
  reports(scope: string): Understanding[] {
    const directory = this.path(scope, "discovery/reports");
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((n) => /^[a-f0-9-]{36}\.json$/i.test(n))
      .map(
        (n) =>
          JSON.parse(
            readFileSync(this.path(scope, `discovery/reports/${n}`), "utf8"),
          ) as Understanding,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  get(scope: string, id: string, expected?: string, approved = false) {
    if (
      (approved || expected !== undefined) &&
      (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
    )
      throw new Error("请提交审核时的确切内容摘要");
    const r = this.reports(scope).find((r) => r.id === this.id(id));
    if (
      !r ||
      (expected && expected !== r.digest) ||
      (approved && !r.approvedAt)
    )
      throw new Error("理解版本不存在、已变化或尚未审核通过");
    const markdown = readFileSync(
      this.path(scope, `discovery/reports/${id}.md`),
      "utf8",
    );
    if (
      markdown !== r.markdown ||
      r.digest !==
        digest(
          JSON.stringify({
            markdown,
            captureIds: r.captureIds,
            evidenceHash: r.evidenceHash,
          }),
        ) ||
      this.evidence(scope, this.run(scope, r.runId)) !== r.evidenceHash
    )
      throw new Error("理解文档或依据已变化，请重新生成并审核");
    return r;
  }
  revise(scope: string, id: string, expected: string, markdown: string) {
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
      throw new Error("修订需要原文摘要");
    const original = this.get(scope, id, expected);
    return this.create(scope, this.run(scope, original.runId), markdown);
  }
  approve(scope: string, id: string, expected: string) {
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
      throw new Error("审核需要原文摘要");
    const r = this.get(scope, id, expected);
    r.approvedAt ??= new Date().toISOString();
    atomicWrite(
      this.path(scope, `discovery/reports/${id}.json`),
      JSON.stringify(r, null, 2),
    );
    atomicWrite(
      this.path(scope, "discovery/active.json"),
      JSON.stringify({ id: r.id, digest: r.digest }),
    );
    atomicWrite(
      this.path(scope, "memory/产品理解索引.md"),
      `# 已审核产品理解\n\n[当前理解文档](../discovery/reports/${id}.md)\n\n审核时间：${r.approvedAt}\n内容摘要：${r.digest}\n\n历史修订保存在 discovery/reports。\n`,
    );
    const root = this.path(scope, "记忆.md");
    const text = existsSync(root) ? readFileSync(root, "utf8") : "# 项目记忆\n";
    if (!text.includes("(memory/产品理解索引.md)"))
      atomicWrite(
        root,
        text + "\n\n[已审核产品理解](memory/产品理解索引.md)\n",
      );
    return r;
  }
  active(scope: string) {
    const path = this.path(scope, "discovery/active.json");
    if (!existsSync(path)) return null;
    const value = JSON.parse(readFileSync(path, "utf8"));
    return this.get(scope, value.id, value.digest, true);
  }
}
