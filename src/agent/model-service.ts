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
          hasCredential: Boolean(row.credential_ref),
        }
      : null;
  }
  async save(projectId: string, input: ModelInput): Promise<ModelProfile> {
    const old = this.row(projectId);
    if (
      !input ||
      !["openai-compatible", "anthropic"].includes(input.provider) ||
      typeof input.model !== "string" ||
      !input.model.trim() ||
      input.model.length > 200
    )
      throw new Error("模型配置无效");
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
          "INSERT INTO model_profiles(id,provider,endpoint,model,credential_ref) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,endpoint=excluded.endpoint,model=excluded.model,credential_ref=excluded.credential_ref",
        )
        .run(
          projectId,
          input.provider,
          endpoint,
          input.model.trim(),
          reference,
        );
    } catch (error) {
      if (input.token) await this.credentials.delete(reference);
      throw error;
    }
    // Remove replaced credential only after the database points to the new one.
    if (input.token && old?.credential_ref && old.credential_ref !== reference)
      await this.credentials.delete(String(old.credential_ref)).catch(() => {});
    return this.profile(projectId)!;
  }
  async request(
    projectId: string,
    prompt: string,
    signal?: AbortSignal,
  ): Promise<ModelRequest> {
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 50000)
      throw new Error("请输入 1–50000 个字符");
    const row = this.row(projectId);
    if (!row?.credential_ref) throw new Error("请先配置当前项目的模型");
    const token = await this.credentials.get(String(row.credential_ref));
    if (!token) throw new Error("钥匙串中未找到凭证，请重新填写 token");
    return {
      provider: row.provider as ModelRequest["provider"],
      endpoint: String(row.endpoint),
      model: String(row.model),
      token,
      prompt,
      signal,
    };
  }
}
