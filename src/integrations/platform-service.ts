import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { CredentialStore } from "./credentials.js";
import type {
  Platform,
  PlatformConfig,
  PlatformInput,
  PlatformProfile,
  ConnectionTest,
} from "../contracts/platforms.js";

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value))
    throw new Error(`${label}格式无效`);
  return value;
}
function validate(input: PlatformInput): PlatformConfig {
  if (!input || !["feishu", "yunxiao"].includes(input.provider))
    throw new Error("平台配置无效");
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    throw new Error("请输入有效的 HTTPS 地址");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port
  )
    throw new Error("地址不能含凭证、参数、端口或锚点");
  if (input.provider === "feishu") {
    if (
      !url.hostname.endsWith(".feishu.cn") ||
      !/^\/wiki\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname)
    )
      throw new Error("请填写飞书知识库迭代父节点地址（/wiki/…）");
    return {
      provider: "feishu",
      url: url.href,
      appId: identifier(input.appId, "App ID"),
    };
  }
  if (url.hostname !== "devops.aliyun.com")
    throw new Error("当前支持云效中心版，请填写 devops.aliyun.com 项目地址");
  const statusMapping: PlatformConfig["statusMapping"] = {};
  for (const phase of ["published", "merged"] as const) {
    const value = input.statusMapping?.[phase];
    if (value) statusMapping[phase] = identifier(value, "状态 ID");
  }
  return {
    provider: "yunxiao",
    url: url.href,
    organizationId: identifier(input.organizationId, "组织 ID"),
    projectId: identifier(input.projectId, "项目 ID"),
    statusMapping,
  };
}

export class PlatformService {
  constructor(
    private db: DatabaseSync,
    private credentials: CredentialStore,
    private transport: typeof fetch = fetch,
  ) {}
  private row(id: string, provider: Platform) {
    if (
      typeof id !== "string" ||
      !this.db.prepare("SELECT id FROM projects WHERE id=?").get(id)
    )
      throw new Error("项目不存在");
    if (!["feishu", "yunxiao"].includes(provider)) throw new Error("平台无效");
    return this.db
      .prepare("SELECT * FROM connections WHERE project_id=? AND provider=?")
      .get(id, provider);
  }
  profile(id: string, provider: Platform): PlatformProfile | null {
    const row = this.row(id, provider);
    if (!row) return null;
    return {
      ...JSON.parse(String(row.config_json)),
      provider,
      hasCredential: Boolean(row.credential_ref),
    };
  }
  async save(id: string, input: PlatformInput): Promise<PlatformProfile> {
    const config = validate(input),
      old = this.row(id, config.provider);
    if (
      input.secret !== undefined &&
      (typeof input.secret !== "string" ||
        input.secret.length > 16384 ||
        /[\r\n]/.test(input.secret))
    )
      throw new Error("凭证格式无效");
    const previous = old ? JSON.parse(String(old.config_json)) : null;
    if (
      config.provider === "feishu" &&
      old?.credential_ref &&
      previous.appId !== config.appId &&
      !input.secret
    )
      throw new Error("更换 App ID 时需要重新填写 App Secret");
    let reference = old?.credential_ref ? String(old.credential_ref) : null;
    if (input.secret) {
      reference = randomUUID();
      await this.credentials.set(reference, input.secret);
    }
    if (!reference) throw new Error("首次配置请填写平台凭证");
    try {
      this.db
        .prepare(
          "INSERT INTO connections(id,project_id,provider,config_json,credential_ref) VALUES(?,?,?,?,?) ON CONFLICT(project_id,provider) DO UPDATE SET config_json=excluded.config_json,credential_ref=excluded.credential_ref",
        )
        .run(
          randomUUID(),
          id,
          config.provider,
          JSON.stringify(config),
          reference,
        );
    } catch (error) {
      if (input.secret) await this.credentials.delete(reference);
      throw error;
    }
    if (input.secret && old?.credential_ref)
      await this.credentials.delete(String(old.credential_ref)).catch(() => {});
    return this.profile(id, config.provider)!;
  }
  private async request(url: string, init: RequestInit = {}): Promise<any> {
    let response: Response;
    try {
      response = await this.transport(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error("平台请求失败或超时，请检查网络后重新测试");
    }
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "鉴权或权限不足，请检查平台凭证及项目访问权限"
          : `平台请求失败（HTTP ${response.status}）`,
      );
    try {
      const text = await response.text();
      if (text.length > 1_000_000) throw new Error();
      const value = JSON.parse(text);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error();
      return value;
    } catch {
      throw new Error("平台返回无效数据，未确认连接成功");
    }
  }
  async yunxiaoSession(id: string) {
    const row = this.row(id, "yunxiao");
    if (!row?.credential_ref) throw new Error("请先保存云效连接");
    const config = validate({
      ...JSON.parse(String(row.config_json)),
      provider: "yunxiao",
    });
    const token = await this.credentials.get(String(row.credential_ref));
    if (!token) throw new Error("钥匙串未找到云效凭证");
    if (JSON.stringify(this.row(id, "yunxiao")) !== JSON.stringify(row))
      throw new Error("云效配置已变化");
    return { config, token };
  }
  async feishuSession(id: string) {
    const row = this.row(id, "feishu");
    if (!row?.credential_ref) throw new Error("请先保存飞书配置");
    const config = validate({
      ...JSON.parse(String(row.config_json)),
      provider: "feishu",
    });
    const secret = await this.credentials.get(String(row.credential_ref));
    if (!secret) throw new Error("钥匙串未找到飞书凭证");
    const auth = await this.request(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: config.appId, app_secret: secret }),
      },
    );
    if (
      auth.code !== 0 ||
      typeof auth.tenant_access_token !== "string" ||
      !auth.tenant_access_token
    )
      throw new Error("飞书应用鉴权失败");
    if (JSON.stringify(this.row(id, "feishu")) !== JSON.stringify(row))
      throw new Error("飞书配置已变化");
    return { token: auth.tenant_access_token as string, config };
  }
  async test(id: string, provider: Platform): Promise<ConnectionTest> {
    const row = this.row(id, provider);
    if (!row?.credential_ref) throw new Error("请先保存当前项目的平台配置");
    const config = validate({
      ...JSON.parse(String(row.config_json)),
      provider,
    });
    const secret = await this.credentials.get(String(row.credential_ref));
    if (!secret) throw new Error("钥匙串未找到凭证，请重新填写");
    let targetId: string, title: string;
    if (provider === "feishu") {
      const auth = await this.request(
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ app_id: config.appId, app_secret: secret }),
        },
      );
      if (
        auth.code !== 0 ||
        typeof auth.tenant_access_token !== "string" ||
        !auth.tenant_access_token
      )
        throw new Error(
          "飞书应用鉴权失败，请检查 App ID、App Secret 与应用状态",
        );
      const nodeToken = new URL(config.url).pathname.split("/")[2];
      const result = await this.request(
        `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(nodeToken)}`,
        { headers: { Authorization: `Bearer ${auth.tenant_access_token}` } },
      );
      const node = result.data?.node;
      if (
        result.code !== 0 ||
        node?.node_token !== nodeToken ||
        typeof node.space_id !== "string" ||
        node.obj_type !== "docx" ||
        typeof node.title !== "string"
      )
        throw new Error(
          "无法读取飞书父节点，请确认应用有知识库权限，且目标为新版文档节点",
        );
      targetId = node.node_token;
      title = node.title;
    } else {
      const result = await this.request(
        `https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/${config.organizationId}/projects/${config.projectId}`,
        { headers: { "x-yunxiao-token": secret } },
      );
      if (result.id !== config.projectId || typeof result.name !== "string")
        throw new Error("云效返回项目不匹配，请检查中心版组织及项目 ID");
      targetId = result.id;
      title = result.name;
    }
    if (JSON.stringify(this.row(id, provider)) !== JSON.stringify(row))
      throw new Error("测试期间配置发生变化，请重新测试");
    return {
      checkedAt: new Date().toISOString(),
      targetId,
      title: title.slice(0, 200),
      scope: "read-only",
    };
  }
}
