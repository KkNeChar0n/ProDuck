import { listModels } from "./model-catalog.js";
import type {
  ModelCatalogInput,
  ReasoningEffort,
} from "../contracts/models.js";
import { owningProject } from "../projects/releases.js";
import type { CapabilityReport, ModelCapability } from "../contracts/models.js";
import { probeCapabilities } from "./model-client.js";
import type { DatabaseSync } from "node:sqlite";
import type { CredentialStore } from "../integrations/credentials.js";
import { newCredentialReference } from "../integrations/credentials.js";
import type { ModelInput, ModelProfile } from "../contracts/models.js";
import { validateEndpoint, type ModelRequest } from "./model-client.js";
export class ModelService {
  constructor(
    private db: DatabaseSync,
    private credentials: CredentialStore,
  ) {}
  private row(projectId: string) {
    projectId = owningProject(this.db, projectId);
    if (
      typeof projectId !== "string" ||
      !this.db.prepare("SELECT id FROM projects WHERE id=?").get(projectId)
    )
      throw new Error("项目不存在");
    return this.db
      .prepare("SELECT * FROM model_profiles WHERE id=?")
      .get(projectId);
  }
  profile(projectId: string): ModelProfile | null {
    const row = this.row(projectId);
    return row
      ? {
          provider: row.provider as ModelProfile["provider"],
          endpoint: String(row.endpoint),
          model: String(row.model),
          reasoningEffort: String(
            row.reasoning_effort ?? "default",
          ) as ReasoningEffort,
          hasCredential: Boolean(row.credential_ref),
        }
      : null;
  }
  async save(projectId: string, input: ModelInput): Promise<ModelProfile> {
    projectId = owningProject(this.db, projectId);
    const old = this.row(projectId);
    if (
      !input ||
      !["openai-compatible", "anthropic"].includes(input.provider) ||
      typeof input.model !== "string" ||
      !input.model.trim() ||
      input.model.length > 200
    )
      throw new Error("模型配置无效");
    const effort = input.reasoningEffort ?? "default";
    if (
      ![
        "default",
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
      ].includes(effort) ||
      (input.provider === "anthropic" && effort !== "default")
    )
      throw new Error("该供应商不支持此推理强度配置");
    const endpoint = validateEndpoint(input.endpoint);
    if (input.token !== undefined && typeof input.token !== "string")
      throw new Error("凭证格式无效");
    if (
      old &&
      !input.token &&
      (old.endpoint !== endpoint || old.provider !== input.provider)
    )
      throw new Error("更换供应商或服务地址时，请重新填写该服务的 API token");
    let reference = old?.credential_ref ? String(old.credential_ref) : null;
    if (input.token) {
      reference = newCredentialReference();
      await this.credentials.set(reference, input.token);
    }
    if (!reference) throw new Error("首次配置需要填写 API token");
    try {
      this.db
        .prepare(
          "INSERT INTO model_profiles(id,provider,endpoint,model,credential_ref,reasoning_effort) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,endpoint=excluded.endpoint,model=excluded.model,credential_ref=excluded.credential_ref,reasoning_effort=excluded.reasoning_effort",
        )
        .run(
          projectId,
          input.provider,
          endpoint,
          input.model.trim(),
          reference,
          effort,
        );
    } catch (error) {
      if (input.token) await this.credentials.delete(reference);
      throw error;
    }
    if (
      input.token ||
      !old ||
      old.endpoint !== endpoint ||
      old.model !== input.model.trim() ||
      old.provider !== input.provider ||
      old.reasoning_effort !== effort
    )
      this.db
        .prepare("DELETE FROM model_capabilities WHERE project_id=?")
        .run(projectId);
    // Remove replaced credential only after the database points to the new one.
    if (input.token && old?.credential_ref && old.credential_ref !== reference)
      await this.credentials.delete(String(old.credential_ref)).catch(() => {});
    return this.profile(projectId)!;
  }
  async catalog(
    projectId: string,
    input: ModelCatalogInput,
    transport: typeof fetch = fetch,
  ): Promise<string[]> {
    const row = this.row(projectId);
    if (
      !input ||
      !["openai-compatible", "anthropic"].includes(input.provider) ||
      (input.token !== undefined && typeof input.token !== "string")
    )
      throw new Error("模型配置无效");
    const endpoint = validateEndpoint(input.endpoint);
    let token = input.token;
    if (!token) {
      if (
        !row?.credential_ref ||
        row.provider !== input.provider ||
        row.endpoint !== endpoint
      )
        throw new Error("请填写当前服务的 API token 后读取模型列表");
      token =
        (await this.credentials.get(String(row.credential_ref))) ?? undefined;
    }
    if (!token) throw new Error("钥匙串中未找到凭证，请重新填写 token");
    return listModels({ ...input, endpoint, token }, transport);
  }
  capabilities(projectId: string): CapabilityReport | null {
    projectId = owningProject(this.db, projectId);
    this.row(projectId);
    const row = this.db
      .prepare("SELECT report_json FROM model_capabilities WHERE project_id=?")
      .get(projectId);
    return row ? JSON.parse(String(row.report_json)) : null;
  }
  async probe(projectId: string, transport: typeof fetch = fetch) {
    projectId = owningProject(this.db, projectId);
    const before = JSON.stringify(this.row(projectId));
    const report = await probeCapabilities(
      await this.request(projectId, "Test capabilities."),
      transport,
    );
    if (before !== JSON.stringify(this.row(projectId)))
      throw new Error("检测期间模型配置发生变化，请重新检测");
    this.db
      .prepare(
        "INSERT INTO model_capabilities VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET report_json=excluded.report_json",
      )
      .run(projectId, JSON.stringify(report));
    return report;
  }
  requireCapability(projectId: string, capability: ModelCapability) {
    const report = this.capabilities(projectId);
    if (report?.[capability] !== "supported")
      throw new Error(
        `${capability === "image" ? "图像输入" : capability === "tools" ? "原生工具调用" : "文本"}能力尚未通过检测。请检测或切换模型${capability === "image" ? "，也可以继续使用明确标记的文字重建模式" : ""}。`,
      );
  }
  async request(
    projectId: string,
    prompt: string,
    signal?: AbortSignal,
    required: ModelCapability[] = [],
  ): Promise<ModelRequest> {
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 50000)
      throw new Error("请输入 1–50000 个字符");
    for (const capability of required)
      this.requireCapability(projectId, capability);
    const row = this.row(projectId);
    if (!row?.credential_ref) throw new Error("请先配置当前项目的模型");
    const token = await this.credentials.get(String(row.credential_ref));
    if (!token) throw new Error("钥匙串中未找到凭证，请重新填写 token");
    return {
      provider: row.provider as ModelRequest["provider"],
      endpoint: String(row.endpoint),
      model: String(row.model),
      reasoningEffort: String(
        row.reasoning_effort ?? "default",
      ) as ReasoningEffort,
      token,
      prompt,
      signal,
    };
  }
}
