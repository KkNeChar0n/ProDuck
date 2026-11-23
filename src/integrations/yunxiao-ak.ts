import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Workitem, WorkitemState } from "../contracts/yunxiao.js";
import type { YunxiaoPort } from "./yunxiao.js";
const host = "devops.cn-hangzhou.aliyuncs.com";
const identifier = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value))
    throw new Error("云效标识无效，请使用内部 ID");
  return value;
};
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** ACS3 signing over the exact request bytes; no credentials in URL or body. */
export function signYunxiaoAk(
  method: string,
  path: string,
  action: string,
  body: string,
  accessKeyId: string,
  secret: string,
  date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  nonce = randomUUID(),
) {
  const headers: Record<string, string> = {
    host,
    "x-acs-action": action,
    "x-acs-version": "2021-06-25",
    "x-acs-date": date,
    "x-acs-signature-nonce": nonce,
    "x-acs-content-sha256": sha256(body),
  };
  if (body) headers["content-type"] = "application/json; charset=utf-8";
  const keys = Object.keys(headers).sort(),
    signed = keys.join(";");
  const canonical = [
    method,
    path,
    "",
    keys.map((k) => `${k}:${headers[k].trim()}\n`).join(""),
    signed,
    sha256(body),
  ].join("\n");
  const signature = createHmac("sha256", secret)
    .update(`ACS3-HMAC-SHA256\n${sha256(canonical)}`)
    .digest("hex");
  return {
    ...headers,
    accept: "application/json",
    Authorization: `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${signed},Signature=${signature}`,
  };
}
export class YunxiaoAkClient implements YunxiaoPort {
  constructor(
    private organizationId: string,
    private projectId: string,
    private accessKeyId: string,
    private secret: string,
    private transport: typeof fetch = fetch,
  ) {
    identifier(organizationId);
    identifier(projectId);
    if (
      !/^[A-Za-z0-9_-]{1,200}$/.test(accessKeyId) ||
      !secret ||
      /[\r\n]/.test(secret)
    )
      throw new Error("AccessKey 配置无效");
  }
  private async request(
    action: string,
    path: string,
    value?: object,
  ): Promise<any> {
    const body = value ? JSON.stringify(value) : "",
      method = value ? "POST" : "GET";
    let response: Response;
    try {
      response = await this.transport(`https://${host}${path}`, {
        method,
        headers: signYunxiaoAk(
          method,
          path,
          action,
          body,
          this.accessKeyId,
          this.secret,
        ),
        body: body || undefined,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error(
        value ? "云效写入结果未确认，请读回核对" : "云效读取失败，请检查网络",
      );
    }
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "云效 AK 鉴权或权限不足，请检查 AccessKey 和 RAM 授权"
          : `云效 AK 请求失败（HTTP ${response.status}）`,
      );
    let result;
    try {
      const text = await response.text();
      if (text.length > 1_000_000) throw new Error();
      result = JSON.parse(text);
    } catch {
      throw new Error("云效返回无效数据，结果未确认");
    }
    if (result?.success !== true)
      throw new Error(
        "云效未确认操作成功，请检查权限、标识及状态流转；写入结果需读回核对",
      );
    return result;
  }
  private base() {
    return `/organization/${this.organizationId}`;
  }
  async project() {
    const { project } = await this.request(
      "GetProjectInfo",
      `${this.base()}/project/${this.projectId}`,
    );
    if (
      project?.identifier !== this.projectId ||
      project.organizationIdentifier !== this.organizationId ||
      String(project.logicalStatus).toUpperCase() !== "NORMAL" ||
      typeof project.name !== "string"
    )
      throw new Error("云效项目不匹配、已归档或返回无效");
    return { id: this.projectId, name: project.name.slice(0, 200) };
  }
  async item(id: string): Promise<Workitem> {
    const { workitem: w } = await this.request(
      "GetWorkItemInfo",
      `${this.base()}/workitems/${identifier(id)}`,
    );
    if (
      w?.identifier !== id ||
      w.spaceIdentifier !== this.projectId ||
      String(w.logicalStatus).toUpperCase() !== "NORMAL" ||
      typeof w.subject !== "string"
    )
      throw new Error("工作项不属于当前项目、已归档或返回内容无效");
    return {
      id,
      title: w.subject.slice(0, 500),
      projectId: this.projectId,
      typeId: identifier(w.workitemTypeIdentifier),
      status: {
        id: identifier(w.statusIdentifier),
        name: String(w.status ?? w.statusIdentifier).slice(0, 100),
      },
      updatedAt: String(w.updateStatusAt ?? w.gmtModified ?? ""),
    };
  }
  async statuses(_typeId: string, itemId?: string): Promise<WorkitemState[]> {
    const { workflow } = await this.request(
      "GetWorkItemWorkFlowInfo",
      `${this.base()}/workitems/${identifier(itemId)}/getWorkflowInfo`,
    );
    if (!Array.isArray(workflow?.statuses))
      throw new Error("云效工作流状态列表无效");
    return workflow.statuses.map((s: any) => ({
      id: identifier(s.identifier),
      name: String(s.name ?? s.identifier).slice(0, 100),
    }));
  }
  async setStatus(id: string, statusId: string) {
    await this.request("UpdateWorkItem", `${this.base()}/workitems/update`, {
      identifier: identifier(id),
      fieldType: "status",
      propertyKey: "status",
      propertyValue: identifier(statusId),
    });
  }
}
