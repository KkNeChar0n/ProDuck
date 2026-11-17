import type { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  realpathSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWrite, projectPath } from "./storage.js";
import type {
  Project,
  ProjectConnection,
  WorkspaceState,
} from "../contracts/projects.js";
const columns = "id,name,workspace,created_at AS createdAt";
export class ProjectRepository {
  constructor(
    private db: DatabaseSync,
    private statePath: string,
  ) {}
  list(): Project[] {
    return this.db
      .prepare(`SELECT ${columns} FROM projects ORDER BY created_at,id`)
      .all() as unknown as Project[];
  }
  get(id: string): Project {
    if (typeof id !== "string") throw new Error("项目标识无效");
    const row = this.db
      .prepare(`SELECT ${columns} FROM projects WHERE id=?`)
      .get(id);
    if (!row) throw new Error("项目不存在");
    return row as unknown as Project;
  }
  state(): WorkspaceState {
    const projects = this.list();
    let activeProjectId = projects[0]?.id ?? null;
    try {
      const value = JSON.parse(readFileSync(this.statePath, "utf8"));
      if (projects.some((p) => p.id === value.activeProjectId))
        activeProjectId = value.activeProjectId;
    } catch {}
    return { projects, activeProjectId };
  }
  select(id: string): WorkspaceState {
    this.get(id);
    atomicWrite(this.statePath, JSON.stringify({ activeProjectId: id }));
    return this.state();
  }
  create(name: string, parent: string): Project {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
      throw new Error("项目名称需要 1–80 个字符");
    const id = randomUUID(),
      workspace = join(realpathSync(parent), `Produck-${id.slice(0, 8)}`);
    mkdirSync(workspace, { mode: 0o700 });
    const project = {
      id,
      name: name.trim(),
      workspace,
      createdAt: new Date().toISOString(),
    };
    try {
      for (const folder of [
        "sources",
        "memory",
        "prototypes",
        "documents",
        "workflows",
      ])
        mkdirSync(join(workspace, folder));
      atomicWrite(
        join(workspace, "记忆.md"),
        `# ${project.name.replace(/[\r\n]/g, " ")}\n\n尚未导入资料或采集页面。\n`,
      );
      this.db
        .prepare("INSERT INTO projects VALUES(?,?,?,?)")
        .run(id, project.name, workspace, project.createdAt);
    } catch (error) {
      rmSync(workspace, { recursive: true, force: true });
      throw error;
    }
    return project;
  }
  connections(id: string): ProjectConnection[] {
    this.get(id);
    return this.db
      .prepare(
        "SELECT provider,config_json FROM connections WHERE project_id=?",
      )
      .all(id)
      .map((row) => ({
        provider: row.provider as ProjectConnection["provider"],
        url: JSON.parse(String(row.config_json)).url,
      }));
  }
  saveConnection(id: string, input: ProjectConnection): ProjectConnection[] {
    this.get(id);
    if (
      !input ||
      !["feishu", "yunxiao"].includes(input.provider) ||
      typeof input.url !== "string"
    )
      throw new Error("连接配置无效");
    const url = new URL(input.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("请使用不含凭证、参数和锚点的 HTTPS 地址");
    this.db
      .prepare(
        "INSERT INTO connections(id,project_id,provider,config_json) VALUES(?,?,?,?) ON CONFLICT(project_id,provider) DO UPDATE SET config_json=excluded.config_json",
      )
      .run(randomUUID(), id, input.provider, JSON.stringify({ url: url.href }));
    return this.connections(id);
  }
  readMemory(id: string): string {
    const p = this.get(id),
      path = projectPath(p.workspace, "记忆.md");
    if (!existsSync(path)) throw new Error("记忆文件不存在，请检查工作空间");
    return readFileSync(path, "utf8");
  }
}
