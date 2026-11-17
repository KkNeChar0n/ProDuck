import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { atomicWrite, projectPath } from "../projects/storage.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { PrototypeVersion } from "../contracts/workbench.js";
export const hash = (html: string) =>
  createHash("sha256").update(html).digest("hex");
export class PrototypeRepository {
  constructor(
    private db: DatabaseSync,
    private projects: ProjectRepository,
  ) {}
  list(projectId: string): PrototypeVersion[] {
    this.projects.get(projectId);
    return this.db
      .prepare(
        `SELECT a.id,a.created_at AS createdAt,a.content_hash AS contentHash,a.baseline_id AS baselineId,a.source_refs_json AS sourceRefs,EXISTS(SELECT 1 FROM approvals p WHERE p.artifact_id=a.id AND p.content_hash=a.content_hash) AS approved FROM artifact_versions a WHERE a.project_id=? ORDER BY a.created_at DESC,a.rowid DESC`,
      )
      .all(projectId)
      .map(
        (row) =>
          ({
            ...row,
            sourceRefs: JSON.parse(String(row.sourceRefs)),
            approved: Boolean(row.approved),
          }) as unknown as PrototypeVersion,
      );
  }
  read(projectId: string, id: string): string {
    const project = this.projects.get(projectId),
      row = this.db
        .prepare(
          "SELECT relative_path,content_hash FROM artifact_versions WHERE project_id=? AND id=?",
        )
        .get(projectId, id);
    if (!row) throw new Error("该原型不属于当前项目");
    const html = readFileSync(
      projectPath(project.workspace, String(row.relative_path)),
      "utf8",
    );
    if (hash(html) !== row.content_hash)
      throw new Error("原型文件已被外部修改，请创建新版本后重新确认");
    return html;
  }
  create(
    projectId: string,
    html: string,
    sourceRefs: string[],
    baselineId: string | null = null,
  ): PrototypeVersion {
    const project = this.projects.get(projectId);
    if (baselineId) this.read(projectId, baselineId);
    if (
      !/<html[\s>]/i.test(html) ||
      !/<\/html>/i.test(html) ||
      Buffer.byteLength(html) > 2 * 1024 * 1024
    )
      throw new Error("模型没有返回完整 HTML，或文件超过 2 MB");
    const id = randomUUID(),
      relativePath = `prototypes/${id}.html`,
      contentHash = hash(html),
      createdAt = new Date().toISOString();
    atomicWrite(projectPath(project.workspace, relativePath), html);
    this.db
      .prepare("INSERT INTO artifact_versions VALUES(?,?,?,?,?,?,?)")
      .run(
        id,
        projectId,
        baselineId,
        relativePath,
        contentHash,
        JSON.stringify(sourceRefs),
        createdAt,
      );
    return {
      id,
      createdAt,
      contentHash,
      baselineId,
      sourceRefs,
      approved: false,
    };
  }
  approve(projectId: string, id: string): PrototypeVersion {
    const contentHash = hash(this.read(projectId, id));
    const found = this.list(projectId).find((v) => v.id === id)!;
    if (!found.approved)
      this.db
        .prepare("INSERT INTO approvals VALUES(?,?,?,?)")
        .run(randomUUID(), id, contentHash, new Date().toISOString());
    return { ...found, approved: true };
  }
  compare(projectId: string, beforeId: string, afterId: string) {
    const before = this.read(projectId, beforeId),
      after = this.read(projectId, afterId);
    return {
      before,
      after,
      identical: before === after,
      beforeHash: hash(before),
      afterHash: hash(after),
    };
  }
  restore(projectId: string, id: string): PrototypeVersion {
    const v = this.list(projectId).find((v) => v.id === id);
    if (!v) throw new Error("原型不存在");
    return this.create(projectId, this.read(projectId, id), v.sourceRefs, id);
  }
}
