import { owningProject, releaseUrl } from "./releases.js";
import type { ProductRelease } from "../contracts/projects.js";
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
  releases(projectId: string): ProductRelease[] {
    this.get(projectId);
    return this.db
      .prepare(
        "SELECT id,project_id AS projectId,name,relative_path AS relativePath,feishu_url AS feishuUrl,created_at AS createdAt FROM releases WHERE project_id=? ORDER BY created_at,rowid",
      )
      .all(projectId) as unknown as ProductRelease[];
  }
  release(id: string): ProductRelease {
    const row = this.db
      .prepare("SELECT project_id FROM releases WHERE id=?")
      .get(id);
    if (!row) throw new Error("请先创建并选择产品版本");
    return this.releases(String(row.project_id)).find((r) => r.id === id)!;
  }
  shared(id: string): Project {
    return this.get(owningProject(this.db, id));
  }
  context(id: string): Project {
    const release = this.release(id),
      project = this.get(release.projectId);
    return {
      ...project,
      id: release.id,
      name: `${project.name} / ${release.name}`,
      workspace: projectPath(project.workspace, release.relativePath),
    };
  }
  createRelease(projectId: string, name: string): ProductRelease {
    const project = this.get(projectId);
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80)
      throw new Error("版本名称需要 1–80 个字符");
    if (this.releases(projectId).some((r) => r.name === name.trim()))
      throw new Error("版本名称已存在");
    const id = randomUUID(),
      relativePath = `releases/${id}`;
    const workspace = projectPath(project.workspace, relativePath);
    mkdirSync(workspace, { recursive: true, mode: 0o700 });
    try {
      for (const folder of ["prototypes", "documents", "workflows"])
        mkdirSync(join(workspace, folder));
      this.db
        .prepare("INSERT INTO releases VALUES(?,?,?,?,?,?)")
        .run(
          id,
          projectId,
          name.trim(),
          relativePath,
          "",
          new Date().toISOString(),
        );
    } catch (e) {
      rmSync(workspace, { recursive: true, force: true });
      throw e;
    }
    return this.release(id);
  }
  updateRelease(id: string, name: string, url: string): ProductRelease {
    this.release(id);
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.trim().length > 80 ||
      typeof url !== "string"
    )
      throw new Error("版本配置无效");
    this.db
      .prepare("UPDATE releases SET name=?,feishu_url=? WHERE id=?")
      .run(name.trim(), releaseUrl(url), id);
    return this.release(id);
  }
  state(): WorkspaceState {
    const projects = this.list();
    let saved: { activeProjectId?: string; activeReleaseId?: string } = {};
    try {
      saved = JSON.parse(readFileSync(this.statePath, "utf8"));
    } catch {}
    const activeProjectId =
      projects.find((p) => p.id === saved.activeProjectId)?.id ??
      projects[0]?.id ??
      null;
    const releases = activeProjectId ? this.releases(activeProjectId) : [];
    const activeReleaseId =
      releases.find((r) => r.id === saved.activeReleaseId)?.id ??
      releases[0]?.id ??
      null;
    return { projects, activeProjectId, releases, activeReleaseId };
  }
  select(id: string): WorkspaceState {
    this.get(id);
    atomicWrite(this.statePath, JSON.stringify({ activeProjectId: id }));
    return this.state();
  }
  selectRelease(projectId: string, releaseId: string): WorkspaceState {
    if (this.release(releaseId).projectId !== projectId)
      throw new Error("版本不属于当前项目");
    atomicWrite(
      this.statePath,
      JSON.stringify({
        activeProjectId: projectId,
        activeReleaseId: releaseId,
      }),
    );
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
    const existing = this.db
      .prepare(
        "SELECT credential_ref FROM connections WHERE project_id=? AND provider=?",
      )
      .get(id, input.provider);
    if (existing?.credential_ref)
      throw new Error("已配置平台凭证，请通过平台连接设置更新地址");
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
