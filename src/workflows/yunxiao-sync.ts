import { randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ProjectRepository } from "../projects/repository.js";
import type { PublicationWorkflow } from "./publication.js";
import type { PlatformService } from "../integrations/platform-service.js";
import type { YunxiaoPort } from "../integrations/yunxiao.js";
import type { YunxiaoSync } from "../contracts/yunxiao.js";
import { atomicWrite, projectPath } from "../projects/storage.js";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class YunxiaoSyncWorkflow {
  private active = new Set<string>();
  constructor(
    private projects: ProjectRepository,
    private publications: Pick<PublicationWorkflow, "list">,
    private platforms: Pick<PlatformService, "profile">,
    private connect: (id: string) => Promise<YunxiaoPort>,
  ) {}
  private path(id: string) {
    return projectPath(
      this.projects.context(id).workspace,
      "workflows/yunxiao-sync.json",
    );
  }
  list(id: string): YunxiaoSync[] {
    const path = this.path(id);
    const rows: YunxiaoSync[] = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : [];
    return rows.map((row) =>
      row.state === "writing" && !this.active.has(id)
        ? {
            ...row,
            state: "needs-check",
            message: "上次同步中断，请读回核对；不会自动重发",
          }
        : row,
    );
  }
  private save(id: string, record: YunxiaoSync, stage: string) {
    record.updatedAt = new Date().toISOString();
    record.events.push({ at: record.updatedAt, stage });
    atomicWrite(
      this.path(id),
      JSON.stringify(
        [record, ...this.list(id).filter((r) => r.id !== record.id)],
        null,
        2,
      ),
    );
  }
  private publication(id: string, runId: string) {
    const run = this.publications
      .list(id)
      .find((r) => r.id === runId && r.state === "published");
    if (!run?.documentUrl || run.steps.some((s) => s.state !== "done"))
      throw new Error("飞书尚未完整发布并读回，不可同步云效");
    return run;
  }
  private config(id: string) {
    const config = this.platforms.profile(id, "yunxiao");
    if (
      !config?.hasCredential ||
      !config.organizationId ||
      !config.projectId ||
      !config.statusMapping?.published
    )
      throw new Error(
        "请在项目设置配置云效及“首次发布成功后”的状态 ID；留空不会同步",
      );
    return config;
  }
  private digest(row: YunxiaoSync) {
    return hash([
      row.publicationId,
      row.publicationDigest,
      row.organizationId,
      row.projectId,
      row.configHash,
      row.item,
      row.target,
    ]);
  }
  async prepare(id: string, publicationId: string, itemId: string) {
    if (this.active.has(id)) throw new Error("当前项目正在同步云效");
    this.active.add(id);
    try {
      const run = this.publication(id, publicationId),
        config = this.config(id);
      const previous = this.list(id).find(
        (r) =>
          r.publicationId === publicationId &&
          r.item.id === itemId &&
          (r.writeAttempted || r.state === "synced"),
      );
      if (previous?.writeAttempted || previous?.state === "synced")
        return previous;
      const client = await this.connect(id),
        item = await client.item(itemId),
        statuses = await client.statuses(item.typeId, item.id),
        target = statuses.find((s) => s.id === config.statusMapping!.published);
      if (item.projectId !== config.projectId || !target)
        throw new Error("项目不匹配或映射状态不在该工作项类型的工作流中");
      if (
        hash(config) !== hash(this.config(id)) ||
        run.digest !== this.publication(id, publicationId).digest
      )
        throw new Error("准备期间配置或发布记录变化，请重试");
      const row: YunxiaoSync = {
        id: randomUUID(),
        publicationId,
        publicationDigest: run.digest,
        organizationId: config.organizationId!,
        projectId: config.projectId!,
        configHash: hash(config),
        item,
        target,
        digest: "",
        state: "prepared",
        createdAt: new Date().toISOString(),
        updatedAt: "",
        writeAttempted: false,
        events: [],
      };
      row.digest = this.digest(row);
      this.save(id, row, "已读取工作项及工作流映射，等待确认");
      return row;
    } finally {
      this.active.delete(id);
    }
  }
  review(id: string, syncId: string, digest: string) {
    const row = this.list(id).find((r) => r.id === syncId);
    if (!row || row.digest !== digest || this.digest(row) !== digest)
      throw new Error("同步记录已变化，请重新准备");
    const config = this.config(id),
      run = this.publication(id, row.publicationId);
    if (hash(config) !== row.configHash || run.digest !== row.publicationDigest)
      throw new Error("连接、映射或发布记录已变化，旧确认不可执行");
    return row;
  }
  async execute(id: string, syncId: string, digest: string) {
    if (this.active.has(id)) throw new Error("当前项目正在同步云效");
    const row = this.review(id, syncId, digest);
    // Prevent a previously prepared parallel record from replaying another attempt.
    if (
      this.list(id).some(
        (r) =>
          r.id !== row.id &&
          r.publicationId === row.publicationId &&
          r.item.id === row.item.id &&
          (r.writeAttempted || r.state === "synced"),
      )
    )
      throw new Error("该工作项已有执行记录，请使用原记录核对");
    this.active.add(id);
    try {
      const client = await this.connect(id),
        current = await client.item(row.item.id);
      if (current.projectId !== row.projectId)
        throw new Error("工作项项目归属已变化");
      if (row.writeAttempted || row.state === "synced") {
        row.readback = current;
        row.state =
          current.status.id === row.target.id ? "synced" : "needs-check";
        row.message =
          row.state === "synced"
            ? "读回确认已达到目标状态；本次没有再次写入"
            : "当前状态未达到目标，原请求结果需人工核对；未重发";
        this.save(id, row, "仅读回核对");
        return row;
      }
      if (row.state !== "prepared") throw new Error("请重新准备同步计划");
      if (hash(current) !== hash(row.item)) {
        row.state = "conflict";
        row.message = "工作项标题、类型或状态已变化，请重新准备并确认";
        this.save(id, row, "执行前发生冲突");
        return row;
      }
      const statuses = await client.statuses(current.typeId, current.id);
      if (
        !statuses.some(
          (s) => s.id === row.target.id && s.name === row.target.name,
        )
      )
        throw new Error("目标状态配置已变化，请重新准备");
      this.review(id, syncId, digest);
      if (current.status.id !== row.target.id) {
        row.state = "writing";
        row.writeAttempted = true;
        this.save(id, row, "写入前检查完成，已记录发送意图");
        await client.setStatus(current.id, row.target.id);
        this.save(id, row, "收到更新响应，尚待读回");
      }
      row.readback = await client.item(current.id);
      row.state =
        row.readback.projectId === row.projectId &&
        row.readback.status.id === row.target.id
          ? "synced"
          : "needs-check";
      row.message =
        row.state === "synced"
          ? "云效状态已读回确认"
          : "读回状态不匹配，未确认同步成功";
      this.save(id, row, "完成状态读回");
      return row;
    } catch (error) {
      row.state = row.writeAttempted ? "needs-check" : "prepared";
      row.message = error instanceof Error ? error.message : "同步未完成";
      this.save(id, row, "同步未完成，保留飞书发布成果");
      return row;
    } finally {
      this.active.delete(id);
    }
  }
}
