import type { DatabaseSync } from "node:sqlite";
/** Resolve an immutable execution scope to the project owning its credentials. */
export function owningProject(db: DatabaseSync, id: string): string {
  if (typeof id !== "string") throw new Error("项目或版本标识无效");
  const release = db
    .prepare("SELECT project_id FROM releases WHERE id=?")
    .get(id);
  if (release) return String(release.project_id);
  if (db.prepare("SELECT id FROM projects WHERE id=?").get(id)) return id;
  throw new Error("项目或版本不存在");
}
export function releaseUrl(value: string): string {
  if (!value) return "";
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".feishu.cn") ||
    !/^\/wiki\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw new Error("请填写不含凭证、参数或锚点的飞书知识库迭代地址");
  return url.href;
}
