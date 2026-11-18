import type { Workitem, WorkitemState } from "../contracts/yunxiao.js";
const identifier = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value))
    throw new Error("云效标识无效，请使用内部 ID");
  return value;
};
export interface YunxiaoPort {
  item(id: string): Promise<Workitem>;
  statuses(typeId: string): Promise<WorkitemState[]>;
  setStatus(id: string, statusId: string): Promise<void>;
}
export class YunxiaoClient implements YunxiaoPort {
  constructor(
    private organizationId: string,
    private projectId: string,
    private token: string,
    private transport: typeof fetch = fetch,
  ) {
    identifier(organizationId);
    identifier(projectId);
  }
  private async request(path: string, statusId?: string): Promise<any> {
    let response: Response;
    try {
      response = await this.transport(
        `https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/${this.organizationId}/${path}`,
        {
          method: statusId ? "PUT" : "GET",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            "x-yunxiao-token": this.token,
            ...(statusId ? { "Content-Type": "application/json" } : {}),
          },
          body: statusId ? JSON.stringify({ status: statusId }) : undefined,
        },
      );
    } catch {
      throw new Error(
        statusId
          ? "云效写入结果未确认，请读回核对"
          : "云效读取失败，请检查网络",
      );
    }
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "云效鉴权或权限不足"
          : `云效请求失败（HTTP ${response.status}）`,
      );
    if (statusId) return;
    try {
      const body = await response.text();
      if (body.length > 1_000_000) throw new Error();
      return JSON.parse(body);
    } catch {
      throw new Error("云效返回无效数据");
    }
  }
  async item(id: string): Promise<Workitem> {
    const value = await this.request(`workitems/${identifier(id)}`);
    if (
      value?.id !== id ||
      value.space?.id !== this.projectId ||
      value.logicalStatus !== "normal" ||
      typeof value.subject !== "string"
    )
      throw new Error("工作项不属于当前项目、已归档或返回内容无效");
    return {
      id,
      title: value.subject.slice(0, 500),
      projectId: this.projectId,
      typeId: identifier(value.workitemType?.id),
      status: {
        id: identifier(value.status?.id),
        name: String(
          value.status.displayName ?? value.status.name ?? value.status.id,
        ).slice(0, 100),
      },
      updatedAt: String(value.updateStatusAt ?? value.gmtModified ?? ""),
    };
  }
  async statuses(typeId: string): Promise<WorkitemState[]> {
    const value = await this.request(
      `projects/${this.projectId}/workitemTypes/${identifier(typeId)}/workflows`,
    );
    if (!Array.isArray(value?.statuses))
      throw new Error("云效工作流状态列表无效");
    return value.statuses.map((s: any) => ({
      id: identifier(s.id),
      name: String(s.displayName ?? s.name ?? s.id).slice(0, 100),
    }));
  }
  async setStatus(id: string, statusId: string) {
    await this.request(`workitems/${identifier(id)}`, identifier(statusId));
  }
}
